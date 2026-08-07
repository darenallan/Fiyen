package models

import (
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleCompagnie Role = "compagnie"
	RoleLivreur   Role = "livreur"
	RoleClient    Role = "client"
)

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

type Client struct {
	ID            uuid.UUID `json:"id"`
	Nom           string    `json:"nom"`
	TelephoneHash string    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
}

type Utilisateur struct {
	ID             uuid.UUID  `json:"id"`
	Role           Role       `json:"role"`
	TelephoneHash  string     `json:"-"`
	MotDePasseHash string     `json:"-"`
	CompagnieID    *uuid.UUID `json:"compagnie_id,omitempty"`
	LivreurID      *uuid.UUID `json:"livreur_id,omitempty"`
	ClientID       *uuid.UUID `json:"client_id,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

type Course struct {
	ID             uuid.UUID    `json:"id"`
	CompagnieID    uuid.UUID    `json:"compagnie_id"`
	ClientID       uuid.UUID    `json:"client_id"`
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
