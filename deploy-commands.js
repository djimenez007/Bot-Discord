const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    // 1. Comando Torneo
    new SlashCommandBuilder()
        .setName('torneo')
        .setDescription('Juega un torneo contra la CPU con dificultad incremental'),

    // 2. Comando Give All Cards (Admin)
    new SlashCommandBuilder()
        .setName('giveallcards')
        .setDescription('Otorga todas las cartas registradas a un usuario específico (Solo Admin)')
        .addUserOption(option =>
            option
                .setName('usuario')
                .setDescription('El usuario que recibirá todas las cartas')
                .setRequired(true)
        ),

    // AGREGA AQUÍ TUS OTROS COMANDOS SI TIENES MÁS (ej. claim, inventory, match, etc.)
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Registrando comandos Slash en Discord...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ ¡Comandos cargados exitosamente!');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
})();