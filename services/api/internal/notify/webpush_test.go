package notify

import (
	"crypto/ecdh"
	"strings"
	"testing"
	"time"
)

// RFC 8291, Appendix A: the example message, byte for byte.
func TestSeal_rfc8291(t *testing.T) {
	dec := func(s string) []byte {
		b, err := b64.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	as, err := ecdh.P256().NewPrivateKey(dec("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	ua, err := ecdh.P256().NewPublicKey(dec("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := seal([]byte("When I grow up, I want to be a watermelon"), ua,
		dec("BTBZMqHH6r4Tts7J_aSIgg"), as, dec("DGv6ra1nlYgDCS1FRnbzlw"))
	if err != nil {
		t.Fatal(err)
	}
	// The RFC's record size is 4096 too.
	want := "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if b64.EncodeToString(got) != want {
		t.Fatalf("got  %s\nwant %s", b64.EncodeToString(got), want)
	}
}

func TestKey(t *testing.T) {
	k := testKey(t)
	if pub, _ := b64.DecodeString(k.Public()); len(pub) != 65 || pub[0] != 4 {
		t.Fatalf("public %q", k.Public())
	}
	h, err := k.authorization("https://push.example/abc?x=1", "mailto:seb@local.test", time.Unix(1000, 0))
	if err != nil {
		t.Fatal(err)
	}
	token, rest, ok := strings.Cut(strings.TrimPrefix(h, "vapid t="), ", k=")
	if !ok || rest != k.Public() || !k.verify(token) {
		t.Fatalf("header %q", h)
	}
	if k.verify(token+"x") || k.verify("a.b") {
		t.Fatal("a broken token verified")
	}
	if _, err := k.authorization("not a url", "", time.Now()); err == nil {
		t.Fatal("no endpoint, no header")
	}

	for name, text := range map[string]string{
		"not pem": "hello",
		"rsa":     pemOf(t, "rsa"),
		"p384":    pemOf(t, "p384"),
		"garbage": pemOf(t, "garbage"),
	} {
		if _, err := ParseKey(text); err == nil {
			t.Errorf("%s: parsed", name)
		}
	}
	if _, err := ParseKey(pemOf(t, "sec1")); err != nil {
		t.Errorf("SEC 1: %v", err)
	}
}

func TestEncrypt(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(randReader{})
	p256dh := b64.EncodeToString(ua.PublicKey().Bytes())
	auth := b64.EncodeToString(make([]byte, 16))
	if _, err := encrypt([]byte("hi"), p256dh, auth, randReader{}); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string][2]string{
		"bad p256dh":   {"!!", auth},
		"short p256dh": {"AAAA", auth},
		"bad auth":     {p256dh, "AAAA"},
	} {
		if _, err := encrypt([]byte("hi"), c[0], c[1], randReader{}); err == nil {
			t.Errorf("%s: encrypted", name)
		}
	}
	if _, err := encrypt(make([]byte, recordSize), p256dh, auth, randReader{}); err == nil {
		t.Error("too long: encrypted")
	}
}
