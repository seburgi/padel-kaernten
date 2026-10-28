package notify

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/url"
	"time"
)

var b64 = base64.RawURLEncoding

// Key is the VAPID key the pushes are signed with (RFC 8292): a P-256 key,
// the secret padel-vapid-private-key. Browsers get its public half when
// they subscribe and refuse pushes signed with any other.
type Key struct {
	private *ecdsa.PrivateKey
	public  []byte // uncompressed point, 65 bytes
}

// ParseKey reads a PEM private key, PKCS #8 or SEC 1.
func ParseKey(text string) (*Key, error) {
	block, _ := pem.Decode([]byte(text))
	if block == nil {
		return nil, errors.New("notify: the VAPID key is not PEM")
	}
	var k *ecdsa.PrivateKey
	if any, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		var ok bool
		if k, ok = any.(*ecdsa.PrivateKey); !ok {
			return nil, errors.New("notify: the VAPID key is not an EC key")
		}
	} else if k, err = x509.ParseECPrivateKey(block.Bytes); err != nil {
		return nil, fmt.Errorf("notify: the VAPID key: %w", err)
	}
	pub, err := k.PublicKey.Bytes()
	if err != nil || len(pub) != 65 {
		return nil, errors.New("notify: the VAPID key is not P-256")
	}
	return &Key{private: k, public: pub}, nil
}

// Public is what the app hands the browser as applicationServerKey.
func (k *Key) Public() string { return b64.EncodeToString(k.public) }

// authorization is the Authorization header for a push to endpoint: a
// JWT for the push service's origin, valid twelve hours (RFC 8292).
func (k *Key) authorization(endpoint, contact string, now time.Time) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("notify: endpoint %q", endpoint)
	}
	head := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, err := json.Marshal(map[string]any{
		"aud": u.Scheme + "://" + u.Host,
		"exp": now.Add(12 * time.Hour).Unix(),
		"sub": contact,
	})
	if err != nil {
		return "", err
	}
	signed := head + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signed))
	r, s, err := ecdsa.Sign(rand.Reader, k.private, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return "vapid t=" + signed + "." + b64.EncodeToString(sig) + ", k=" + k.Public(), nil
}

// verify is the push service's check of a signature, for the tests.
func (k *Key) verify(token string) bool {
	var head, claims, sig string
	if n, _ := fmt.Sscanf(dotted(token), "%s %s %s", &head, &claims, &sig); n != 3 {
		return false
	}
	raw, err := b64.DecodeString(sig)
	if err != nil || len(raw) != 64 {
		return false
	}
	digest := sha256.Sum256([]byte(head + "." + claims))
	return ecdsa.Verify(&k.private.PublicKey, digest[:], new(big.Int).SetBytes(raw[:32]), new(big.Int).SetBytes(raw[32:]))
}

func dotted(s string) string {
	out := []byte(s)
	for i, c := range out {
		if c == '.' {
			out[i] = ' '
		}
	}
	return string(out)
}

// recordSize is the one record a push holds; payloads stay far below it.
const recordSize = 4096

// encrypt is RFC 8291's aes128gcm for the browser's keys: p256dh, its
// public key, and auth, the secret it shares with us. salt and the
// ephemeral key come from random unless a test sets them.
func encrypt(plain []byte, p256dh, auth string, random io.Reader) ([]byte, error) {
	uaRaw, err := b64.DecodeString(p256dh)
	if err != nil {
		return nil, fmt.Errorf("notify: p256dh: %w", err)
	}
	secret, err := b64.DecodeString(auth)
	if err != nil || len(secret) != 16 {
		return nil, errors.New("notify: auth is not 16 bytes")
	}
	ua, err := ecdh.P256().NewPublicKey(uaRaw)
	if err != nil {
		return nil, fmt.Errorf("notify: p256dh: %w", err)
	}
	as, err := ecdh.P256().GenerateKey(random)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := io.ReadFull(random, salt); err != nil {
		return nil, err
	}
	return seal(plain, ua, secret, as, salt)
}

func seal(plain []byte, ua *ecdh.PublicKey, secret []byte, as *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	shared, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPub := as.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), ua.Bytes()...), asPub...)
	ikm, err := hkdf.Key(sha256.New, shared, secret, string(info), 32)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// One record, the last: the plaintext and the delimiter 2, no padding.
	if len(plain)+1+gcm.Overhead() > recordSize {
		return nil, errors.New("notify: the message is too long for one push")
	}
	head := make([]byte, 0, 16+4+1+len(asPub))
	head = append(head, salt...)
	head = binary.BigEndian.AppendUint32(head, recordSize)
	head = append(head, byte(len(asPub)))
	head = append(head, asPub...)
	return gcm.Seal(head, nonce, append(append([]byte{}, plain...), 2), nil), nil
}
