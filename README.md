# Gestion de Stock

App web complète de gestion de stock. Backend Node.js/Express + SQLite, frontend vanilla JS.

## Stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** HTML/CSS/JS (dans `public/`)
- **DB:** SQLite (fichier `stock.db` créé au démarrage)

## Installation

```bash
npm install
```

## Lancer

```bash
npm start
```

Puis ouvrir http://localhost:3000

Mode dev avec reload :

```bash
npm run dev
```

## Fonctionnalités

- Création de produits (nom unique + quantité initiale)
- Ajout / retrait de stock avec garde anti-négatif
- Suppression de produit
- Historique persistant des mouvements (create/in/out/delete)

## API

| Méthode | Route                        | Description                         |
|---------|------------------------------|-------------------------------------|
| GET     | `/api/products`              | Liste des produits                  |
| POST    | `/api/products`              | Créer `{name, qty}`                 |
| POST    | `/api/products/:id/stock`    | Ajuster stock `{delta}` (+/-)       |
| DELETE  | `/api/products/:id`          | Supprimer un produit                |
| GET     | `/api/history?limit=50`      | Historique des mouvements           |

## Structure

```
.
├── server.js       # Express API + static
├── db.js           # SQLite init + schéma
├── package.json
├── public/         # Frontend servi en statique
│   ├── index.html
│   ├── style.css
│   └── app.js
└── stock.db        # Créé au premier lancement (gitignore)
```
