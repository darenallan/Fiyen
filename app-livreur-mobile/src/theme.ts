import { StyleSheet } from 'react-native';

/**
 * Charte Fiyen Delivery, alignée sur les trois interfaces web.
 *
 * Neutres CHAUDS et non gris froids : un gris neutre fait paraître l'or terne.
 * `orSombre` est borné à #B08E4C — plus bas, le texte des boutons repasserait
 * sous le seuil de contraste de 4,5:1.
 */
export const couleurs = {
  or: '#c5a059',
  orClair: '#e3c68a',
  orSombre: '#b08e4c',
  kraft: '#d2b48c',

  fond: '#100f0d',
  panneau: '#1c1a16',
  panneauHaut: '#2b2721',
  bordure: '#403930',

  texte: '#f5f5f5',
  texteAttenue: '#b5ac9b',
  encre: '#17150f',
  succes: '#7cc98b',
  danger: '#e88b8b',
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
    // Champ en creux : plus sombre que la carte qui le porte.
    backgroundColor: couleurs.fond,
    marginTop: 6,
  },
  bouton: {
    // React Native ne gère pas les dégradés CSS : l'effet métallique du web est
    // approché par la teinte médiane de l'or et un liseré clair en bordure.
    backgroundColor: couleurs.or,
    borderWidth: 1,
    borderColor: couleurs.orClair,
    borderRadius: 10,
    // cible tactile confortable, utilisable d'une main à l'arrêt
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  boutonTexte: {
    color: couleurs.encre,
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
      return { fond: 'rgba(124,201,139,0.14)', texte: couleurs.succes };
    case 'en_course':
    case 'assignee':
    case 'recuperee':
    case 'en_route':
      return { fond: 'rgba(197,160,89,0.14)', texte: couleurs.or };
    default:
      return { fond: couleurs.bordure, texte: couleurs.texteAttenue };
  }
}
