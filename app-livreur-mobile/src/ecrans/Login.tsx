import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, ApiError, decodeRole, definirToken } from '../api';
import { styles, couleurs } from '../theme';
import { URL_PAR_DEFAUT, definirServeur, testerServeur, urlApi } from '../serveur';
import { avertissement, normaliserUrlServeur } from '../serveurLogique';
import { IDENTIFIANTS_DEMO, MODE_DEMO } from '../demo';

/**
 * Réglage de l'adresse du serveur, replié par défaut : le livreur n'a pas à
 * s'en occuper, mais l'IP du PC de test change, et l'API passera en HTTPS.
 * L'adresse n'est enregistrée qu'une fois qu'un serveur Fiyen y a répondu.
 */
function ReglageServeur() {
  const [ouvert, setOuvert] = useState(false);
  const [actuelle, setActuelle] = useState(urlApi());
  const [saisie, setSaisie] = useState(urlApi());
  const [message, setMessage] = useState<string | null>(null);
  const [test, setTest] = useState(false);

  async function enregistrer() {
    const r = normaliserUrlServeur(saisie);
    if (!r.ok) {
      setMessage(`Adresse refusée : ${r.raison}.`);
      return;
    }
    setTest(true);
    setMessage(null);
    const repond = await testerServeur(r.url);
    setTest(false);
    if (!repond) {
      setMessage(`Aucun serveur Fiyen ne répond à ${r.url}. Vérifiez le Wi-Fi, l'adresse et le pare-feu du PC.`);
      return;
    }
    await definirServeur(r.url);
    setActuelle(r.url);
    setSaisie(r.url);
    setOuvert(false);
    setMessage(avertissement(r.url) ?? 'Serveur enregistré.');
  }

  async function reinitialiser() {
    await definirServeur(null);
    setActuelle(URL_PAR_DEFAUT);
    setSaisie(URL_PAR_DEFAUT);
    setMessage('Adresse d’origine rétablie.');
  }

  return (
    <View style={{ marginTop: 28 }}>
      <Text style={styles.attenue}>Serveur : {actuelle}</Text>
      {message && <Text style={[styles.attenue, { marginTop: 6 }]} accessibilityRole="alert">{message}</Text>}
      {!ouvert ? (
        <Pressable onPress={() => setOuvert(true)} accessibilityRole="button" style={{ paddingVertical: 10 }}>
          <Text style={{ color: couleurs.texte, textDecorationLine: 'underline' }}>Modifier l’adresse du serveur</Text>
        </Pressable>
      ) : (
        <View>
          <TextInput
            style={styles.champ}
            value={saisie}
            onChangeText={setSaisie}
            placeholder="http://192.168.1.20:8090"
            placeholderTextColor={couleurs.texteAttenue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Adresse du serveur"
          />
          <Pressable style={[styles.bouton, { marginTop: 10 }, test && styles.boutonInactif]} disabled={test} onPress={enregistrer}>
            <Text style={styles.boutonTexte}>{test ? 'Test…' : 'Tester et enregistrer'}</Text>
          </Pressable>
          {actuelle !== URL_PAR_DEFAUT && (
            <Pressable onPress={reinitialiser} accessibilityRole="button" style={{ paddingVertical: 10 }}>
              <Text style={{ color: couleurs.texte, textDecorationLine: 'underline' }}>Revenir à l’adresse d’origine</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export function Login({ onConnecte }: { onConnecte: () => void }) {
  const [telephone, setTelephone] = useState(MODE_DEMO ? IDENTIFIANTS_DEMO.telephone : '');
  const [motDePasse, setMotDePasse] = useState(MODE_DEMO ? IDENTIFIANTS_DEMO.motDePasse : '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function seConnecter() {
    setErreur(null);
    setEnCours(true);
    try {
      const { token, refresh_token } = await api.login(telephone.trim(), motDePasse);
      if (decodeRole(token) !== 'livreur') {
        setErreur("Ce compte n'est pas un compte livreur.");
        return;
      }
      await definirToken(token, refresh_token);
      onConnecte();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setEnCours(false);
    }
  }

  const pret = telephone.trim() !== '' && motDePasse !== '' && !enCours;

  return (
    <KeyboardAvoidingView
      style={styles.ecran}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[styles.contenu, { paddingTop: 32 }]}>
        <Text style={styles.titre}>Fiyen Livreur</Text>
        <Text style={[styles.attenue, { marginTop: 4, marginBottom: MODE_DEMO ? 14 : 24 }]}>
          Connectez-vous avec le numéro fourni par votre compagnie.
        </Text>

        {MODE_DEMO && (
          <View style={[styles.carte, { marginBottom: 20 }]}>
            <Text style={[styles.sousTitre, { marginBottom: 6 }]}>Version de démonstration</Text>
            <Text style={styles.attenue}>
              Données fictives, aucune connexion à un serveur. Les identifiants sont déjà remplis :
              appuyez sur « Se connecter », puis prenez votre service.
            </Text>
          </View>
        )}

        <Text style={styles.attenue}>Téléphone</Text>
        <TextInput
          style={styles.champ}
          value={telephone}
          onChangeText={setTelephone}
          placeholder="+22670000000"
          placeholderTextColor={couleurs.texteAttenue}
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoComplete="tel"
        />

        <Text style={[styles.attenue, { marginTop: 14 }]}>Mot de passe</Text>
        <TextInput
          style={styles.champ}
          value={motDePasse}
          onChangeText={setMotDePasse}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
        />

        {erreur && <Text style={styles.erreur}>{erreur}</Text>}

        <Pressable
          style={[styles.bouton, { marginTop: 22 }, !pret && styles.boutonInactif]}
          disabled={!pret}
          onPress={seConnecter}
        >
          <Text style={styles.boutonTexte}>{enCours ? 'Connexion…' : 'Se connecter'}</Text>
        </Pressable>

        {!MODE_DEMO && <ReglageServeur />}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
