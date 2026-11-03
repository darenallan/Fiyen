package database

import "testing"

func TestOptionsRedis_AdresseLocaleInchangee(t *testing.T) {
	o, err := optionsRedis("localhost:6379", "")
	if err != nil || o.Addr != "localhost:6379" || o.TLSConfig != nil {
		t.Fatalf("local : %+v, %v", o, err)
	}
}

func TestOptionsRedis_URLChiffreeActiveTLS(t *testing.T) {
	// Forme donnée par Upstash : rediss://default:<mot de passe>@<hôte>:6379
	o, err := optionsRedis("rediss://default:secret-fictif@exemple.upstash.io:6379", "")
	if err != nil {
		t.Fatal(err)
	}
	if o.TLSConfig == nil {
		t.Fatal("rediss:// doit activer TLS : sans lui, un Redis hébergé refuse la connexion")
	}
	if o.Addr != "exemple.upstash.io:6379" || o.Password != "secret-fictif" {
		t.Fatalf("adresse ou mot de passe mal lus : %+v", o)
	}
}

func TestOptionsRedis_MotDePasseSepare(t *testing.T) {
	o, err := optionsRedis("redis://exemple:6379", "depuis-la-variable")
	if err != nil || o.Password != "depuis-la-variable" || o.TLSConfig != nil {
		t.Fatalf("%+v, %v", o, err)
	}
}
