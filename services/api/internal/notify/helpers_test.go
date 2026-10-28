package notify

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
)

// pemOf is a key as Seb would put it into the secret, made for the test:
// no key lives in the repository (tools/checks.py).
func pemOf(t *testing.T, kind string) string {
	t.Helper()
	var der []byte
	var err error
	typ := "PRIVATE KEY"
	switch kind {
	case "pkcs8", "sec1":
		k, kerr := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if kerr != nil {
			t.Fatal(kerr)
		}
		if kind == "sec1" {
			typ = "EC PRIVATE KEY"
			der, err = x509.MarshalECPrivateKey(k)
		} else {
			der, err = x509.MarshalPKCS8PrivateKey(k)
		}
	case "p384":
		k, kerr := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
		if kerr != nil {
			t.Fatal(kerr)
		}
		der, err = x509.MarshalPKCS8PrivateKey(k)
	case "rsa":
		k, kerr := rsa.GenerateKey(rand.Reader, 1024)
		if kerr != nil {
			t.Fatal(kerr)
		}
		der, err = x509.MarshalPKCS8PrivateKey(k)
	default:
		der = []byte{0, 0, 0}
	}
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}))
}

func testKey(t *testing.T) *Key {
	t.Helper()
	k, err := ParseKey(pemOf(t, "pkcs8"))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

type randReader struct{}

func (randReader) Read(p []byte) (int, error) { return rand.Read(p) }
