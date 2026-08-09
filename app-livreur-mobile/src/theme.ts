import { StyleSheet } from 'react-native';

/**
 * Charte Fiyen Delivery, alignée sur les trois interfaces web
 * (app-client/src/index.css fait référence).
 *
 * Terracotta sur fond chaud : `primary` tient 4,98:1 avec du blanc, et le noir
 * de marque #1A1A1A reste la couleur de texte.
 */
export const couleurs = {
  vert: '#16332a',
  vert2: '#1e4235',
  vert3: '#2c5646',
  creme: '#f5efe1',
  creme2: '#eae0c6',
  or: '#e0a526',
  orProfond: '#b37e1a',
  rust: '#d9581f',

  fond: '#f5efe1',
  panneau: '#f5efe1',
  panneauHaut: '#eae0c6',
  bordure: '#eae0c6',

  texte: '#16332a',
  texteAttenue: '#55605a',
  texteMuet: '#55605a',
  surCouleur: '#f5efe1',
  succes: '#3b6349',
  danger: '#a53f13',
};

export const styles = StyleSheet.create({
  ecran: {
    flex: 1,
    backgroundColor: couleurs.fond,
  },
  contenu: {
    padding: 16,
    paddingBottom: 32,
  },
  titre: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: couleurs.texte,
  },
  sousTitre: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: couleurs.texteAttenue,
    marginBottom: 12,
  },
  attenue: {
    fontSize: 14,
    color: couleurs.texteAttenue,
  },
  carte: {
    backgroundColor: couleurs.panneau,
    borderColor: couleurs.bordure,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  champ: {
    borderColor: couleurs.bordure,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: couleurs.texte,
    backgroundColor: couleurs.panneau,
    marginTop: 6,
  },
  bouton: {
    backgroundColor: couleurs.or,
    borderRadius: 10,
    // cible tactile confortable, utilisable d'une main à l'arrêt
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  boutonTexte: {
    color: couleurs.vert,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  boutonContour: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: couleurs.bordure,
  },
  boutonContourTexte: {
    color: couleurs.texte,
  },
  boutonDanger: {
    backgroundColor: couleurs.danger,
  },
  boutonInactif: {
    opacity: 0.45,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: couleurs.bordure,
  },
  badgeTexte: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: couleurs.texteAttenue,
  },
  ligne: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: couleurs.bordure,
  },
  erreur: {
    color: couleurs.danger,
    fontSize: 14,
    marginTop: 10,
  },
});

export function couleurStatut(statut: string, enService = true) {
  if (!enService) return { fond: couleurs.bordure, texte: couleurs.texteAttenue };
  switch (statut) {
    case 'dispo':
    case 'livree':
      return { fond: 'rgba(107,143,94,0.18)', texte: couleurs.succes };
    case 'en_course':
    case 'assignee':
    case 'recuperee':
    case 'en_route':
      return { fond: couleurs.or, texte: couleurs.vert };
    default:
      return { fond: couleurs.bordure, texte: couleurs.texteAttenue };
  }
}
