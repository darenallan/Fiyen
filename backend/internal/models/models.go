package models

import (
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleCompagnie Role = "compagnie"
	RoleLivreur   Role = "livreur"
	// RoleDestinataire : le particulier qui reçoit le colis. Anciennement
	// « client » — le mot est devenu ambigu quand la compagnie a eu des
	// entreprises clientes.
	RoleDestinataire Role = "destinataire"
	// RolePartenaire : le compte principal d'une entreprise cliente. Il commande
	// et gère ses collaborateurs.
	RolePartenaire Role = "partenaire"
	// RoleCollaborateur : un employé du partenaire. Il commande au nom de son
	// entreprise, sans pouvoir en gérer les comptes.
	RoleCollaborateur Role = "collaborateur"
)

// PeutCommanderPourPartenaire dit si un rôle passe commande au nom d'un
// partenaire. Les deux rôles ont les mêmes droits sur les courses ; seule la
// gestion des collaborateurs les sépare.
func PeutCommanderPourPartenaire(r Role) bool {
	return r == RolePartenaire || r == RoleCollaborateur
}

type StatutLivreur string

const (
	LivreurOffline  StatutLivreur = "offline"
	LivreurDispo    StatutLivreur = "dispo"
	LivreurEnCourse StatutLivreur = "en_course"
)

type StatutCourse string

const (
	CourseEnAttente StatutCourse = "en_attente"
	CourseAssignee  StatutCourse = "assignee"
	CourseRecuperee StatutCourse = "recuperee"
	CourseEnRoute   StatutCourse = "en_route"
	CourseLivree    StatutCourse = "livree"
	CourseAnnulee   StatutCourse = "annulee"
)

// transitionsAutorisees décrit les statuts suivants valides pour une course.
var transitionsAutorisees = map[StatutCourse][]StatutCourse{
	CourseEnAttente: {CourseAssignee, CourseAnnulee},
	CourseAssignee:  {CourseRecuperee, CourseAnnulee},
	CourseRecuperee: {CourseEnRoute, CourseAnnulee},
	CourseEnRoute:   {CourseLivree},
}

func TransitionValide(de, vers StatutCourse) bool {
	for _, s := range transitionsAutorisees[de] {
		if s == vers {
			return true
		}
	}
	return false
}

type Compagnie struct {
	ID        uuid.UUID `json:"id"`
	Nom       string    `json:"nom"`
	Statut    string    `json:"statut"`
	CreatedAt time.Time `json:"created_at"`
}

type ConfigTarifaire struct {
	ID                    uuid.UUID `json:"id"`
	CompagnieID           uuid.UUID `json:"compagnie_id"`
	AbonnementMensuel     float64   `json:"abonnement_mensuel"`
	LivreursInclus        int       `json:"livreurs_inclus"`
	CommissionPourcentage float64   `json:"commission_pourcentage"`
	Devise                string    `json:"devise"`
	ActiveAPartir         time.Time `json:"active_a_partir"`
	CreatedAt             time.Time `json:"created_at"`
}

type Livreur struct {
	ID            uuid.UUID     `json:"id"`
	CompagnieID   uuid.UUID     `json:"compagnie_id"`
	Nom           string        `json:"nom"`
	TelephoneHash string        `json:"-"`
	Statut        StatutLivreur `json:"statut"`
	CreatedAt     time.Time     `json:"created_at"`
}

type PositionLivreur struct {
	LivreurID uuid.UUID `json:"livreur_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Destinataire — celui à qui le colis est remis.
type Destinataire struct {
	ID            uuid.UUID `json:"id"`
	Nom           string    `json:"nom"`
	TelephoneHash string    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
}

type Utilisateur struct {
	ID             uuid.UUID  `json:"id"`
	Role           Role       `json:"role"`
	Nom            *string    `json:"nom,omitempty"`
	TelephoneHash  string     `json:"-"`
	MotDePasseHash string     `json:"-"`
	CompagnieID    *uuid.UUID `json:"compagnie_id,omitempty"`
	LivreurID      *uuid.UUID `json:"livreur_id,omitempty"`
	DestinataireID *uuid.UUID `json:"destinataire_id,omitempty"`
	PartenaireID   *uuid.UUID `json:"partenaire_id,omitempty"`
	Actif          bool       `json:"actif"`
	CreatedAt      time.Time  `json:"created_at"`
}

// VisibiliteCollaborateurs décide de ce qu'un collaborateur voit des courses de
// son entreprise. Le choix appartient au partenaire, faute d'arbitrage du
// client : « entreprise » convient à une boutique où deux personnes se
// relaient, « personnelle » à une structure où chacun suit ses propres envois.
type VisibiliteCollaborateurs string

const (
	VisibiliteEntreprise  VisibiliteCollaborateurs = "entreprise"
	VisibilitePersonnelle VisibiliteCollaborateurs = "personnelle"
)

// Partenaire — une entreprise cliente d'une compagnie de livraison.
type Partenaire struct {
	ID          uuid.UUID `json:"id"`
	CompagnieID uuid.UUID `json:"compagnie_id"`
	Nom         string    `json:"nom"`
	// Repere plutôt qu'adresse postale : à Ouagadougou, la plupart des
	// commerces n'ont pas d'adresse normalisée.
	Repere        *string                  `json:"repere,omitempty"`
	TelephoneHash *string                  `json:"-"`
	Statut        string                   `json:"statut"`
	Visibilite    VisibiliteCollaborateurs `json:"visibilite_collaborateurs"`
	CreatedAt     time.Time                `json:"created_at"`

	// Renseignés par les vues de liste, pas par la table.
	NbCollaborateurs int `json:"nb_collaborateurs"`
	NbCourses        int `json:"nb_courses"`
}

// Collaborateur — vue d'un compte rattaché à un partenaire, telle que
// l'affiche l'écran de gestion. Ni numéro ni empreinte n'en sortent.
type Collaborateur struct {
	ID        uuid.UUID `json:"id"`
	Nom       string    `json:"nom"`
	Role      Role      `json:"role"`
	Actif     bool      `json:"actif"`
	NbCourses int       `json:"nb_courses"`
	CreatedAt time.Time `json:"created_at"`
}

// Invitation — un collaborateur convié mais dont le compte n'existe pas encore.
type Invitation struct {
	ID        uuid.UUID `json:"id"`
	Nom       string    `json:"nom"`
	ExpireAt  time.Time `json:"expire_at"`
	CreatedAt time.Time `json:"created_at"`
	// Le code n'est renvoyé qu'à sa création, jamais relu : seul son hash est
	// conservé. Le partenaire doit le transmettre lui-même à l'invité.
	Code string `json:"code,omitempty"`
}

type Course struct {
	ID             uuid.UUID    `json:"id"`
	CompagnieID    uuid.UUID    `json:"compagnie_id"`
	DestinataireID uuid.UUID    `json:"destinataire_id"`
	LivreurID      *uuid.UUID   `json:"livreur_id,omitempty"`
	Statut         StatutCourse `json:"statut"`
	AdresseDepart  string       `json:"adresse_depart"`
	AdresseArrivee string       `json:"adresse_arrivee"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
}

type SessionMasquage struct {
	ID            uuid.UUID `json:"id"`
	CourseID      uuid.UUID `json:"course_id"`
	NumeroVirtuel *string   `json:"numero_virtuel,omitempty"`
	ExpireAt      time.Time `json:"expire_at"`
	CreatedAt     time.Time `json:"created_at"`
}
