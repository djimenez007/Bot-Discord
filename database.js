const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Inicializar base de datos SQLite
const db = new Database(path.join(__dirname, 'bot_futbol.db'));

// Habilitar claves foráneas
db.pragma('foreign_keys = ON');

// 1. Tabla de Usuarios
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        coins INTEGER DEFAULT 0,
        last_claim INTEGER DEFAULT 0
    )
`);

// 2. Tabla de Cartas de Jugadores (Añadido 'category' para las estrellas)
db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
        card_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        pos TEXT NOT NULL,
        overall INTEGER NOT NULL,
        rarity TEXT NOT NULL,
        category INTEGER DEFAULT 3,
        sho INTEGER NOT NULL,
        pas INTEGER NOT NULL,
        dri INTEGER NOT NULL,
        def INTEGER NOT NULL,
        giq INTEGER NOT NULL,
        aer INTEGER NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT
    )
`);

// 3. Tabla de Inventario
db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        card_id INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY(card_id) REFERENCES cards(card_id) ON DELETE CASCADE
    )
`);

// 4. Tabla de Plantillas Titulares
db.exec(`
    CREATE TABLE IF NOT EXISTS squads (
        user_id TEXT PRIMARY KEY,
        gk_id INTEGER,
        lb_id INTEGER,
        rb_id INTEGER,
        cm_id INTEGER,
        lf_id INTEGER,
        cf_id INTEGER,
        rf_id INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY(gk_id) REFERENCES cards(card_id) ON DELETE SET NULL,
        FOREIGN KEY(lb_id) REFERENCES cards(card_id) ON DELETE SET NULL,
        FOREIGN KEY(rb_id) REFERENCES cards(card_id) ON DELETE SET NULL,
        FOREIGN KEY(cm_id) REFERENCES cards(card_id) ON DELETE SET NULL,
        FOREIGN KEY(lf_id) REFERENCES cards(card_id) ON DELETE SET NULL,
        FOREIGN KEY(cf_id) REFERENCES cards(card_id) ON DELETE SET NULL,
        FOREIGN KEY(rf_id) REFERENCES cards(card_id) ON DELETE SET NULL
    )
`);

// Cargar cartas iniciales desde el JSON si la tabla está vacía
const checkCards = db.prepare('SELECT COUNT(*) AS count FROM cards').get();

if (checkCards.count === 0) {
    const jsonPath = path.join(__dirname, 'cards.json');

    if (fs.existsSync(jsonPath)) {
        const cardsData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        const insertCard = db.prepare(`
            INSERT INTO cards (name, pos, overall, rarity, category, sho, pas, dri, def, giq, aer, price, image_url)
            VALUES (@name, @pos, @overall, @rarity, @category, @sho, @pas, @dri, @def, @giq, @aer, @price, @image_url)
        `);

        const insertMany = db.transaction((cards) => {
            for (const card of cards) {
                // Si la carta no trae 'category', le asigna 3 por defecto
                card.category = card.category !== undefined ? card.category : 3;
                insertCard.run(card);
            }
        });

        insertMany(cardsData);
        console.log(`🌱 Se registraron ${cardsData.length} cartas desde cards.json exitosamente.`);
    } else {
        console.warn('⚠️ No se encontró el archivo cards.json para cargar las cartas iniciales.');
    }
}

module.exports = db;