const db = require('./database');

// Coloca aquí tu ID de Discord de usuario
const MY_USER_ID = '1120089949312647208'; 

function giveAllCardsToInventory() {
    console.log('🔄 Añadiendo todas las cartas al inventario del usuario:', MY_USER_ID);

    // 1. Asegurar que existas en la tabla de usuarios
    db.prepare('INSERT OR IGNORE INTO users (user_id, last_claim) VALUES (?, ?)').run(MY_USER_ID, 0);

    // 2. Obtener todas las cartas registradas en la base de datos
    const cards = db.prepare('SELECT card_id, name, pos FROM cards').all();

    if (cards.length === 0) {
        console.log('❌ No hay cartas en la tabla `cards` para agregar.');
        return;
    }

    // 3. Añadir cada una de las cartas a tu inventario
    const insertInv = db.prepare('INSERT INTO inventory (user_id, card_id) VALUES (?, ?)');
    
    cards.forEach(card => {
        insertInv.run(MY_USER_ID, card.card_id);
        console.log(`➕ Carta agregada a tu inventario: ID ${card.card_id} - ${card.name} (${card.pos})`);
    });

    console.log('\n✅ ¡Cartas entregadas exitosamente!');
    console.log('👉 Ejecuta `/inventory` en Discord para ver tus IDs y luego usa `/setlineup` para armar tu equipo.');
}

giveAllCardsToInventory();