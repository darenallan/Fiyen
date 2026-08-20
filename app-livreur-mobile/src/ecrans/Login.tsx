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

export function Login({ onConnecte }: { onConnecte: () => void }) {
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
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
        <Text style={[styles.attenue, { marginTop: 4, marginBottom: 24 }]}>
          Connectez-vous avec le numéro fourni par votre compagnie.
        </Text>

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

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
