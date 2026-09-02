package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Service de notifications d'Expo.
//
// Contrat repris de la documentation officielle : un POST sur
// https://exp.host/--/api/v2/push/send, avec un tableau d'au plus 100 messages,
// et une réponse `{"data":[{"status":"ok"|"error", ...}]}` dans l'ordre des
// messages envoyés.

const (
	urlExpoParDefaut = "https://exp.host/--/api/v2/push/send"

	// Plafond imposé par Expo. Les lots plus grands sont découpés.
	maxParLot = 100

	// Au-delà, on abandonne : l'assignation d'une course ne doit pas rester
	// suspendue parce qu'un service tiers ne répond pas.
	delaiParDefaut = 10 * time.Second

	// Code renvoyé par Expo pour un appareil qui ne peut plus rien recevoir.
	codeAppareilPerdu = "DeviceNotRegistered"
)

// EnvoyeurExpo parle au service de notifications d'Expo.
type EnvoyeurExpo struct {
	URL string
	// JetonAcces n'est nécessaire que si la sécurité push est activée sur le
	// tableau de bord EAS. Vide par défaut, ce qui correspond à la
	// configuration courante.
	JetonAcces string
	Client     *http.Client
}

// NouvelEnvoyeurExpo construit un envoyeur prêt à l'emploi.
func NouvelEnvoyeurExpo(jetonAcces string) *EnvoyeurExpo {
	return &EnvoyeurExpo{
		URL:        urlExpoParDefaut,
		JetonAcces: jetonAcces,
		Client:     &http.Client{Timeout: delaiParDefaut},
	}
}

type messageExpo struct {
	To    string            `json:"to"`
	Title string            `json:"title,omitempty"`
	Body  string            `json:"body,omitempty"`
	Data  map[string]string `json:"data,omitempty"`
	// « high » sur Android réveille l'appareil : une course qui attend n'a pas
	// vocation à patienter jusqu'au prochain réveil du système.
	Priority string `json:"priority,omitempty"`
}

type reponseExpo struct {
	Data []struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
	Errors []struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

// Envoyer expédie la notification à chaque jeton, par lots de 100.
func (e *EnvoyeurExpo) Envoyer(ctx context.Context, jetons []string, n Notification) ([]Resultat, error) {
	if len(jetons) == 0 {
		return nil, nil
	}

	resultats := make([]Resultat, 0, len(jetons))
	for debut := 0; debut < len(jetons); debut += maxParLot {
		fin := debut + maxParLot
		if fin > len(jetons) {
			fin = len(jetons)
		}

		lot, err := e.envoyerLot(ctx, jetons[debut:fin], n)
		if err != nil {
			// Les lots déjà partis sont conservés : une panne au troisième lot
			// ne doit pas faire oublier que les deux premiers sont arrivés.
			return resultats, err
		}
		resultats = append(resultats, lot...)
	}
	return resultats, nil
}

func (e *EnvoyeurExpo) envoyerLot(ctx context.Context, jetons []string, n Notification) ([]Resultat, error) {
	if len(jetons) > maxParLot {
		return nil, ErrLotTropGrand
	}

	messages := make([]messageExpo, 0, len(jetons))
	for _, j := range jetons {
		messages = append(messages, messageExpo{
			To:       j,
			Title:    n.Titre,
			Body:     n.Corps,
			Data:     n.Donnees,
			Priority: "high",
		})
	}

	corps, err := json.Marshal(messages)
	if err != nil {
		return nil, fmt.Errorf("sérialisation des messages: %w", err)
	}

	url := e.URL
	if url == "" {
		url = urlExpoParDefaut
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(corps))
	if err != nil {
		return nil, fmt.Errorf("préparation de la requête: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if e.JetonAcces != "" {
		req.Header.Set("Authorization", "Bearer "+e.JetonAcces)
	}

	client := e.Client
	if client == nil {
		client = &http.Client{Timeout: delaiParDefaut}
	}

	rep, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("appel du service de notifications: %w", err)
	}
	defer rep.Body.Close()

	var decode reponseExpo
	if err := json.NewDecoder(rep.Body).Decode(&decode); err != nil {
		return nil, fmt.Errorf("réponse illisible (%d): %w", rep.StatusCode, err)
	}

	// Erreur au niveau de la requête entière : aucun message n'est parti.
	if rep.StatusCode >= 400 || len(decode.Errors) > 0 {
		message := fmt.Sprintf("service de notifications: HTTP %d", rep.StatusCode)
		if len(decode.Errors) > 0 {
			message = fmt.Sprintf("service de notifications: %s (%s)",
				decode.Errors[0].Message, decode.Errors[0].Code)
		}
		return nil, fmt.Errorf("%s", message)
	}

	// La réponse suit l'ordre des messages envoyés. Une longueur différente
	// signifie qu'on ne peut plus associer un verdict à un jeton : mieux vaut
	// le dire que d'attribuer au hasard.
	if len(decode.Data) != len(jetons) {
		return nil, fmt.Errorf("réponse incohérente : %d verdicts pour %d jetons",
			len(decode.Data), len(jetons))
	}

	resultats := make([]Resultat, 0, len(jetons))
	for i, verdict := range decode.Data {
		resultats = append(resultats, Resultat{
			Jeton:     jetons[i],
			Livre:     verdict.Status == "ok",
			JetonMort: verdict.Details.Error == codeAppareilPerdu,
			Message:   verdict.Message,
		})
	}
	return resultats, nil
}
