require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");
const config = require("./config.json");
const db = require("./database");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatPrice = (amount) => {
  if (amount === undefined || amount === null) return "0";
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

/**
 * Carga de imágenes de forma segura con encodeURI y manejo de errores
 */
async function safeLoadImage(src) {
  if (!src) throw new Error("Image source is undefined or empty");

  if (typeof src === "string" && src.startsWith("http")) {
    const sanitizedUrl = encodeURI(src);
    return await loadImage(sanitizedUrl);
  }

  // Si es una ruta local o relativa
  let localPath = src;
  if (!path.isAbsolute(src)) {
    localPath = path.join(__dirname, "assets", path.basename(src));
  }

  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file does not exist: ${localPath}`);
  }

  return await loadImage(localPath);
}

// Map de emojis actualizados con las nuevas cartas
const PACK_ICONS = {
  mythic: "<:mythiccard:1545312600353407026>",
  legendary: "<:goldcard:1545312598814236693>",
  epic: "<:epiccard:1545312596964675656>",
  rare: "<:rarecard:1545312597954404363>",
  common: "<:basiccard:1545312601439993936>",
};

// Iconos específicos para los sobres en la tienda (utilizan los mismos de PACK_ICONS)
const shopPacks = [
  { id: "mythic", icon: PACK_ICONS.mythic, name: "Mythic Pack", minOvr: 99, maxOvr: 110, price: 5000000, description: "Contains cards between 99 - 110 OVR.", stock: 3 },
  { id: "legendary", icon: PACK_ICONS.legendary, name: "Legendary Pack", minOvr: 90, maxOvr: 98, price: 2000000, description: "Contains cards between 90 - 98 OVR.", stock: 5 },
  { id: "epic", icon: PACK_ICONS.epic, name: "Epic Pack", minOvr: 83, maxOvr: 89, price: 800000, description: "Contains cards between 83 - 89 OVR.", stock: 10 },
  { id: "rare", icon: PACK_ICONS.rare, name: "Rare Pack", minOvr: 75, maxOvr: 82, price: 300000, description: "Contains cards between 75 - 82 OVR.", stock: 15 },
  { id: "common", icon: PACK_ICONS.common, name: "Common Pack", minOvr: 65, maxOvr: 74, price: 100000, description: "Contains cards between 65 - 74 OVR.", stock: 25 },
];

function getPackIconByOvr(ovr) {
  if (ovr >= 99) return PACK_ICONS.mythic;
  if (ovr >= 90) return PACK_ICONS.legendary;
  if (ovr >= 83) return PACK_ICONS.epic;
  if (ovr >= 75) return PACK_ICONS.rare;
  return PACK_ICONS.common;
}

// Sistema de efectos para Pasivas y Ultimates
const SKILL_EFFECTS = {
  // Pasivas
  "Sniper": { sho: 10, pas: 0, dri: 0, def: 0, giq: 5, aer: 0 },
  "Wall": { sho: 0, pas: 0, dri: 0, def: 15, giq: 0, aer: 10 },
  "Playmaker": { sho: 0, pas: 15, dri: 10, def: 0, giq: 5, aer: 0 },
  "Speedster": { sho: 5, pas: 0, dri: 15, def: 0, giq: 0, aer: 0 },

  // Ultimates
  "Thunder Strike": { sho: 25, pas: 0, dri: 0, def: 0, giq: 10, aer: 0, pos: ["cf", "lf", "rf"], type: "shoot" },
  "Iron Defense": { sho: 0, pas: 0, dri: 0, def: 30, giq: 0, aer: 15, pos: ["lb", "rb"], type: "defense" },
  "Golden Pass": { sho: 0, pas: 30, dri: 10, def: 0, giq: 10, aer: 0, pos: ["cm"], type: "pass" },
  "Stomp Dribbler": { sho: 0, pas: 0, dri: 25, def: 0, giq: 5, aer: 0, pos: ["cm", "lf", "rf", "cf"], type: "dribble" },
  "Acrobatic Save": { sho: 0, pas: 0, dri: 0, def: 25, giq: 15, aer: 25, pos: ["gk"], type: "save" }
};

function getEffectiveStat(player, statName) {
  if (!player) return 50;
  let baseValue = player[statName] || 50;

  if (player.passive && SKILL_EFFECTS[player.passive]) {
    baseValue += SKILL_EFFECTS[player.passive][statName] || 0;
  }

  if (player.ultimate && SKILL_EFFECTS[player.ultimate]) {
    baseValue += SKILL_EFFECTS[player.ultimate][statName] || 0;
  }

  return baseValue;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim a random player card."),
  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Display your obtained cards in your club."),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Display your starting lineup on the pitch."),
  new SlashCommandBuilder()
    .setName("setlineup")
    .setDescription("Assign a player from your club to their natural position in the lineup.")
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Name of the player you want to align")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("match")
    .setDescription("Play a simulated match against another user.")
    .addUserOption((option) =>
      option
        .setName("opponent")
        .setDescription("The user you want to play against")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell a card from your inventory by name.")
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Name of the player you want to sell")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a player from your starting lineup.")
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Name of the player you want to remove from lineup")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Display available cards in the shop (refreshes hourly).")
    .addStringOption((option) =>
      option
        .setName("buy")
        .setDescription("Name of the pack you want to buy")
        .setRequired(false)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Display your club profile, balance, and statistics."),
  new SlashCommandBuilder()
    .setName("giveallcards")
    .setDescription("Grant all registered cards to a specific user (Admin Only).")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user who will receive all cards")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("fuse")
    .setDescription("Fuse 3 copies of the same card to obtain a guaranteed higher OVR card.")
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Name of the player you have 3 or more copies of")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("card_info")
    .setDescription("Display detailed information about a specific card.")
    .addStringOption((option) =>
      option
        .setName("card")
        .setDescription("Name of the card you want to inspect")
        .setRequired(true)
        .setAutocomplete(true)
    ),
].map((command) => command.toJSON());

client.once("ready", async () => {
  console.log(`✅ Bot online as: ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });
    console.log("✅ Commands registered successfully.");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
});

const POSITIONS_MAP = {
  gk_id: { x: 755, y: 650, width: 180, height: 260 },
  lb_id: { x: 480, y: 500, width: 180, height: 260 },
  rb_id: { x: 1050, y: 500, width: 180, height: 260 },
  cm_id: { x: 755, y: 350, width: 180, height: 260 },
  lf_id: { x: 500, y: 150, width: 180, height: 260 },
  cf_id: { x: 755, y: 100, width: 180, height: 260 },
  rf_id: { x: 1060, y: 150, width: 180, height: 260 },
};

const POS_TO_COLUMN = {
  GK: "gk_id",
  LB: "lb_id",
  RB: "rb_id",
  CM: "cm_id",
  LF: "lf_id",
  CF: "cf_id",
  RF: "rf_id",
};

function getCategoryStars(category) {
  const starsCount = parseInt(category, 10);
  if (isNaN(starsCount) || starsCount < 1) return "⭐";
  return "⭐".repeat(starsCount);
}

function getUserSquad(userId) {
  const squad = db
    .prepare("SELECT * FROM squads WHERE user_id = ?")
    .get(userId);
  if (!squad) return null;

  const positions = [
    "gk_id",
    "lb_id",
    "rb_id",
    "cm_id",
    "lf_id",
    "cf_id",
    "rf_id",
  ];
  const team = {};

  positions.forEach((posKey) => {
    const cardId = squad[posKey];
    if (cardId) {
      const card = db
        .prepare("SELECT * FROM cards WHERE card_id = ?")
        .get(cardId);
      const posClean = posKey.replace("_id", "");
      team[posClean] = card || null;
    }
  });

  return team;
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const focusedOption = interaction.options.getFocused(true);

    if (interaction.commandName === "setlineup" && focusedOption.name === "player") {
      const focusedValue = focusedOption.value.toLowerCase();
      const userId = interaction.user.id;

      try {
        const userCards = db
          .prepare(
            `
            SELECT DISTINCT cards.name, cards.pos, cards.overall 
            FROM inventory 
            JOIN cards ON inventory.card_id = cards.card_id 
            WHERE inventory.user_id = ? AND LOWER(cards.name) LIKE ?
            LIMIT 25
          `
          )
          .all(userId, `%${focusedValue}%`);

        const choices = userCards.map((card) => ({
          name: `${card.name} [${card.pos}] - OVR ${card.overall}`,
          value: card.name,
        }));

        await interaction.respond(choices);
      } catch (error) {
        console.error("Error in autocomplete for /setlineup:", error);
      }
    }

    if (interaction.commandName === "card_info" && focusedOption.name === "card") {
      const focusedValue = focusedOption.value.toLowerCase();

      try {
        const cardsList = db
          .prepare(
            `
            SELECT name, pos, overall 
            FROM cards 
            WHERE LOWER(name) LIKE ?
            LIMIT 25
          `
          )
          .all(`%${focusedValue}%`);

        const choices = cardsList.map((card) => ({
          name: `${card.name} [${card.pos}] - OVR ${card.overall}`,
          value: card.name,
        }));

        await interaction.respond(choices);
      } catch (error) {
        console.error("Error in autocomplete for /card_info:", error);
      }
    }

    if (interaction.commandName === "shop" && focusedOption.name === "buy") {
      const focusedValue = focusedOption.value.toLowerCase();
      const filtered = shopPacks.filter(
        (p) =>
          p.id.toLowerCase().includes(focusedValue) ||
          p.name.toLowerCase().includes(focusedValue)
      );

      return await interaction.respond(
        filtered.map((p) => ({
          name: `${p.id.toUpperCase()} - ${formatPrice(p.price)} Coins`,
          value: p.id,
        }))
      );
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "card_info") {
    try {
      await interaction.deferReply();

      const cardNameInput = interaction.options.getString("card").trim();

      const card = db
        .prepare("SELECT * FROM cards WHERE LOWER(name) = LOWER(?) LIMIT 1")
        .get(cardNameInput);

      if (!card) {
        return interaction.editReply({
          content: `❌ Could not find any card named \`${cardNameInput}\`.`,
        });
      }

      const monedaIcon = "<:moneda:1545283928515022909>";
      const habilities = "<:estrella:1545228638822203412>";
      const categoryStarsDisplay = getCategoryStars(card.category);
      const packIcon = getPackIconByOvr(card.overall);

      const embed = new EmbedBuilder()
        .setTitle(`${card.name} ${packIcon}`)
        .setColor("#FFD700")
        .addFields(
          { name: "POS", value: `\`${card.pos}\``, inline: true },
          { name: "OVR", value: `\`${card.overall}\``, inline: true },
          { name: "Rarity", value: `\`${card.rarity ? card.rarity.toUpperCase() : "N/A"}\``, inline: true },
          { name: "Category", value: `${categoryStarsDisplay}`, inline: true },
          { name: `${habilities}Passive`, value: `\`${card.passive || "None"}\``, inline: false },
          { name: `${habilities}Ultimate`, value: `\`${card.ultimate || "None"}\``, inline: false },
          {
            name: "Market Value",
            value: `${monedaIcon} \`${formatPrice(card.price)}\``,
            inline: false,
          }
        );

      const files = [];
      const cardImgSrc = card.image_url || card.image;
      if (cardImgSrc) {
        try {
          if (cardImgSrc.startsWith("http")) {
            embed.setImage(encodeURI(cardImgSrc));
          } else {
            const imagePath = path.join(__dirname, "assets", path.basename(cardImgSrc));
            if (fs.existsSync(imagePath)) {
              const attachment = new AttachmentBuilder(imagePath, { name: path.basename(cardImgSrc) });
              files.push(attachment);
              embed.setImage(`attachment://${path.basename(cardImgSrc)}`);
            }
          }
        } catch (err) {
          console.error(`❌ Error rendering image for card_info (${card.name}):`, err);
        }
      }

      await interaction.editReply({ embeds: [embed], files });
    } catch (error) {
      console.error("Error in /card_info:", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "❌ An error occurred while retrieving card information.",
        });
      } else {
        await interaction.reply({
          content: "❌ An error occurred while retrieving card information.",
          flags: 64,
        });
      }
    }
  }

  if (interaction.commandName === "team") {
    try {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const squad = db
        .prepare("SELECT * FROM squads WHERE user_id = ?")
        .get(userId);

      const pitchPath = path.join(__dirname, "assets", "pitch.png");
      let pitchImage;
      try {
        pitchImage = await safeLoadImage(pitchPath);
      } catch (err) {
        console.error("❌ Failed to load pitch background image:", err);
        throw err;
      }

      const canvas = createCanvas(pitchImage.width, pitchImage.height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(pitchImage, 0, 0, canvas.width, canvas.height);

      const lineupText = [];

      if (squad) {
        const positionLabels = {
          cf_id: "CF",
          lf_id: "LF",
          rf_id: "RF",
          cm_id: "CM",
          lb_id: "LB",
          rb_id: "RB",
          gk_id: "GK"
        };

        const orderedPositions = [
          "cf_id",
          "lf_id",
          "rf_id",
          "cm_id",
          "lb_id",
          "rb_id",
          "gk_id"
        ];

        for (const posKey of orderedPositions) {
          const coords = POSITIONS_MAP[posKey];
          const cardId = squad[posKey];
          const posLabel = positionLabels[posKey] || posKey;

          if (cardId) {
            const card = db
              .prepare("SELECT * FROM cards WHERE card_id = ?")
              .get(cardId);

            if (card) {
              const packIcon = getPackIconByOvr(card.overall);
              lineupText.push(`**${posLabel}:** ${packIcon} **${card.name}** - OVR \`${card.overall}\``);

              const cardImgSrc = card.image_url || card.image;
              if (cardImgSrc) {
                try {
                  const cardImg = await safeLoadImage(cardImgSrc);

                  const drawX = coords.x - coords.width / 2;
                  const drawY = coords.y - coords.height / 2;
                  ctx.drawImage(
                    cardImg,
                    drawX,
                    drawY,
                    coords.width,
                    coords.height
                  );
                } catch (imgErr) {
                  console.error(
                    `❌ Error loading image for card "${card.name}" (ID: ${card.card_id}, SRC: "${cardImgSrc}"):`,
                    imgErr.message
                  );
                }
              }
            } else {
              lineupText.push(`**${posLabel}:** *Empty*`);
            }
          } else {
            lineupText.push(`**${posLabel}:** *Empty*`);
          }
        }
      } else {
        lineupText.push("*No squad configured yet.*");
      }

      const buffer = canvas.toBuffer("image/png");
      const attachment = new AttachmentBuilder(buffer, {
        name: "squad_pitch.png",
      });

      const embed = new EmbedBuilder()
        .setTitle(`📋 ${interaction.user.username}'s Lineup`)
        .setColor("#2ECC71")
        .setDescription(lineupText.join("\n"))
        .setImage("attachment://squad_pitch.png");

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
      console.error("Error in /team:", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "❌ An error occurred while generating your team layout.",
        });
      } else {
        await interaction.reply({
          content: "❌ An error occurred while generating your team layout.",
          flags: 64,
        });
      }
    }
  }

  if (interaction.commandName === "giveallcards") {
    const MY_DISCORD_ID = "1120089949312647208";

    if (interaction.user.id !== MY_DISCORD_ID) {
      return interaction.reply({
        content: "❌ This command does not exist or you lack permissions to execute it.",
        flags: 64,
      });
    }

    try {
      await interaction.deferReply({ flags: 64 });
    } catch (e) {
      return;
    }

    const targetUser = interaction.options.getUser("user");

    try {
      const insertUser = db.prepare(
        "INSERT OR IGNORE INTO users (user_id) VALUES (?)"
      );
      insertUser.run(targetUser.id);

      const allCards = db.prepare("SELECT card_id FROM cards").all();

      if (allCards.length === 0) {
        return await interaction.editReply({
          content: "⚠️ There are no cards registered in the database.",
        });
      }

      const insertInventory = db.prepare(
        "INSERT INTO inventory (user_id, card_id) VALUES (?, ?)"
      );

      const grantAllTransaction = db.transaction((cardsList, userId) => {
        for (const card of cardsList) {
          insertInventory.run(userId, card.card_id);
        }
      });

      grantAllTransaction(allCards, targetUser.id);

      await interaction.editReply({
        content: `✅ Successfully granted **all cards** (${allCards.length} in total) to **${targetUser.username}**.`,
      });
    } catch (error) {
      console.error("Error granting all cards:", error);
      await interaction.editReply({
        content: "❌ An error occurred while adding the cards to the database.",
      });
    }
  }

  if (interaction.commandName === "claim") {
    try {
      await interaction.deferReply();
    } catch (e) {
      return;
    }

    const userId = interaction.user.id;
    const now = Date.now();

    let user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
    if (!user) {
      db.prepare("INSERT INTO users (user_id, last_claim) VALUES (?, ?)").run(userId, 0);
      user = { user_id: userId, last_claim: 0 };
    }

    const rand = Math.random() * 100;
    let minOvr = 65, maxOvr = 74;

    if (rand > 98) { minOvr = 99; maxOvr = 110; }
    else if (rand > 90) { minOvr = 90; maxOvr = 98; }
    else if (rand > 70) { minOvr = 83; maxOvr = 89; }
    else if (rand > 40) { minOvr = 75; maxOvr = 82; }

    let availableCards = db
      .prepare("SELECT * FROM cards WHERE overall BETWEEN ? AND ?")
      .all(minOvr, maxOvr);

    if (!availableCards || availableCards.length === 0) {
      availableCards = db.prepare("SELECT * FROM cards").all();
    }

    if (!availableCards || availableCards.length === 0) {
      return interaction.editReply({
        content: "❌ There are no cards registered in the database.",
      });
    }

    const card = availableCards[Math.floor(Math.random() * availableCards.length)];

    db.prepare("INSERT INTO inventory (user_id, card_id) VALUES (?, ?)").run(userId, card.card_id);
    db.prepare("UPDATE users SET last_claim = ? WHERE user_id = ?").run(now, userId);

    const llamas = "<a:llamas:1545239096220192798>";
    const monedaIcon = "<:moneda:1545283928515022909>";
    const habilities = "<:estrella:1545228638822203412>";
    const categoryStarsDisplay = getCategoryStars(card.category);
    
    const packIcon = getPackIconByOvr(card.overall);

    const embed = new EmbedBuilder()
      .setTitle(`${llamas} You obtained ${card.name}! ${packIcon}`)
      .setColor("#FFD700")
      .addFields(
        { name: "POS", value: `\`${card.pos}\``, inline: true },
        { name: "OVR", value: `\`${card.overall}\``, inline: true },
        { name: "Rarity", value: `\`${card.rarity ? card.rarity.toUpperCase() : "N/A"}\``, inline: true },
        { name: "Category", value: `${categoryStarsDisplay}`, inline: true },
        { name: `${habilities}Passive`, value: `\`${card.passive || "None"}\``, inline: false },
        { name: `${habilities}Ultimate`, value: `\`${card.ultimate || "None"}\``, inline: false },
        {
          name: "Market Value",
          value: `${monedaIcon} \`${formatPrice(card.price)}\``,
          inline: false,
        }
      );

    const files = [];
    const cardImgSrc = card.image_url || card.image;
    if (cardImgSrc) {
      try {
        if (cardImgSrc.startsWith("http")) {
          embed.setImage(encodeURI(cardImgSrc));
        } else {
          const imagePath = path.join(__dirname, "assets", path.basename(cardImgSrc));
          if (fs.existsSync(imagePath)) {
            const attachment = new AttachmentBuilder(imagePath, { name: path.basename(cardImgSrc) });
            files.push(attachment);
            embed.setImage(`attachment://${path.basename(cardImgSrc)}`);
          }
        }
      } catch (err) {
        console.error(`❌ Error rendering image for claim (${card.name}):`, err);
      }
    }

    await interaction.editReply({ embeds: [embed], files });
  }

  if (interaction.commandName === "inventory") {
    const inventoryIcon = "<:inventario:1545274824300044308>";

    try {
      const userId = interaction.user.id;

      const rawItems = db
        .prepare(
          `
            SELECT cards.* 
            FROM inventory 
            JOIN cards ON inventory.card_id = cards.card_id 
            WHERE inventory.user_id = ?
            ORDER BY cards.overall DESC
          `
        )
        .all(userId);

      if (!rawItems || rawItems.length === 0) {
        return interaction.reply({
          content: "Your inventory is empty.",
          flags: 64,
        });
      }

      const cardMap = new Map();
      rawItems.forEach((card) => {
        if (cardMap.has(card.card_id)) {
          cardMap.get(card.card_id).count += 1;
        } else {
          cardMap.set(card.card_id, { ...card, count: 1 });
        }
      });

      const items = Array.from(cardMap.values());
      const ITEMS_PER_PAGE = 10;
      const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
      let currentPage = 0;

      const generateEmbed = (page) => {
        const start = page * ITEMS_PER_PAGE;
        const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

        let description = "Cards Inventory:\n\n";
        pageItems.forEach((card) => {
          const packIcon = getPackIconByOvr(card.overall);
          const countTag = card.count > 1 ? ` x${card.count}` : " x1";
          description += `${packIcon} **${card.name}** [${card.pos}] - OVR **${card.overall}**${countTag}\n`;
        });

        return new EmbedBuilder()
          .setTitle(`${inventoryIcon} ${interaction.user.username}'s Inventory`)
          .setColor("#2B2D31")
          .setDescription(description)
          .setFooter({
            text: `Page ${page + 1} of ${totalPages}`,
          });
      };

      if (totalPages <= 1) {
        return interaction.reply({ embeds: [generateEmbed(0)] });
      }

      const getButtons = (page) => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("inv_prev")
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("inv_next")
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1),
          new ButtonBuilder()
            .setCustomId("inv_filter")
            .setLabel("CARDS")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );
      };

      const response = await interaction.reply({
        embeds: [generateEmbed(currentPage)],
        components: [getButtons(currentPage)],
        withResponse: true,
      });

      const collector = response.resource.message.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "inv_prev") {
          currentPage = Math.max(0, currentPage - 1);
        } else if (i.customId === "inv_next") {
          currentPage = Math.min(totalPages - 1, currentPage + 1);
        }

        await i.update({
          embeds: [generateEmbed(currentPage)],
          components: [getButtons(currentPage)],
        });
      });

      collector.on("end", async () => {
        const disabledButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("inv_prev")
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("inv_next")
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("inv_filter")
            .setLabel("CARDS")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );
        await interaction
          .editReply({ components: [disabledButtons] })
          .catch(() => {});
      });
    } catch (error) {
      console.error("Error in /inventory:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "An error occurred while loading the inventory.",
          flags: 64,
        });
      }
    }
  }

  if (interaction.commandName === "setlineup") {
    const userId = interaction.user.id;
    const playerNameInput = interaction.options.getString("player").trim();

    const owned = db
      .prepare(
        `
            SELECT inventory.card_id, cards.name, cards.pos, cards.card_id
            FROM inventory 
            JOIN cards ON inventory.card_id = cards.card_id 
            WHERE inventory.user_id = ? AND LOWER(cards.name) = LOWER(?)
            LIMIT 1
        `
      )
      .get(userId, playerNameInput);

    if (!owned) {
      return interaction.reply({
        content: `❌ You do not own any player named \`${playerNameInput}\` in your inventory.`,
        flags: 64,
      });
    }

    const positionKey = POS_TO_COLUMN[owned.pos.toUpperCase()];
    if (!positionKey) {
      return interaction.reply({
        content: `❌ The position \`${owned.pos}\` for this player is invalid for the lineup.`,
        flags: 64,
      });
    }

    let squad = db
      .prepare("SELECT * FROM squads WHERE user_id = ?")
      .get(userId);
    if (!squad) {
      db.prepare("INSERT INTO squads (user_id) VALUES (?)").run(userId);
      squad = db.prepare("SELECT * FROM squads WHERE user_id = ?").get(userId);
    }

    if (squad[positionKey] && squad[positionKey] !== owned.card_id) {
      const currentOccupant = db
        .prepare("SELECT name FROM cards WHERE card_id = ?")
        .get(squad[positionKey]);
      const occupantName = currentOccupant
        ? currentOccupant.name
        : "another player";
      return interaction.reply({
        content: `⚠️ The \`${owned.pos}\` position is already occupied by \`${occupantName}\`. To replace them, clear the position or sell the player.`,
        flags: 64,
      });
    }

    db.prepare(`UPDATE squads SET ${positionKey} = ? WHERE user_id = ?`).run(
      owned.card_id,
      userId
    );

    return interaction.reply({
      content: `⚽ \`${owned.name}\` successfully assigned to their natural position (\`${owned.pos}\`).`,
    });
  }

  if (interaction.commandName === "match") {
    const homeUser = interaction.user;
    const awayUser = interaction.options.getUser("opponent");

    if (awayUser.id === homeUser.id) {
      return interaction.reply({
        content: "❌ You cannot play against yourself.",
        flags: 64,
      });
    }

    const homeTeam = getUserSquad(homeUser.id);
    const awayTeam = getUserSquad(awayUser.id);

    if (
      !homeTeam ||
      Object.keys(homeTeam).length < 1 ||
      !awayTeam ||
      Object.keys(awayTeam).length < 1
    ) {
      return interaction.reply({
        content: "❌ Both managers must set up their full lineup with `/setlineup` before playing.",
        flags: 64,
      });
    }

    try {
      await interaction.deferReply();
    } catch (e) {
      return;
    }

    const getStat = (player, stat) => {
      if (!player) return 0;
      let baseStat = getEffectiveStat(player, stat);

      if (player.passive) {
        const passiveConfig = SKILL_EFFECTS[player.passive];
        if (passiveConfig && passiveConfig.stats && passiveConfig.stats[stat]) {
          baseStat += passiveConfig.stats[stat];
        }
      }

      return baseStat;
    };

    const getOverall = (player) => {
      if (!player) return 50;
      let ovr = player.overall || 50;

      if (player.passive) {
        const passiveConfig = SKILL_EFFECTS[player.passive];
        if (passiveConfig && passiveConfig.stats && passiveConfig.stats.overall) {
          ovr += passiveConfig.stats.overall;
        }
      }

      return ovr;
    };

    const getTeamPower = (team) => {
      const mid =
        Math.pow(getStat(team.cm, "pas"), 1.3) * 0.4 +
        Math.pow(getOverall(team.cm), 1.3) * 0.6;

      const cfAtk =
        Math.pow(getStat(team.cf, "sho"), 1.4) +
        Math.pow(getOverall(team.cf), 1.4);
      const lfAtk =
        Math.pow(getStat(team.lf, "sho"), 1.2) +
        Math.pow(getOverall(team.lf), 1.2);
      const rfAtk =
        Math.pow(getStat(team.rf, "sho"), 1.2) +
        Math.pow(getOverall(team.rf), 1.2);
      const atk = cfAtk * 0.5 + lfAtk * 0.25 + rfAtk * 0.25;

      const def =
        (Math.pow(getStat(team.lb, "def") + getOverall(team.lb), 1.2) * 0.35 +
          Math.pow(getStat(team.rb, "def") + getOverall(team.rb), 1.2) * 0.35 +
          Math.pow(getStat(team.cm, "def") + getOverall(team.cm), 1.2) * 0.3) /
        2;

      const gkPower = team.gk
        ? Math.pow(getStat(team.gk, "def"), 1.3) * 0.4 +
          Math.pow(getStat(team.gk, "aer"), 1.3) * 0.3 +
          Math.pow(getOverall(team.gk), 1.3) * 0.3
        : 300;

      return { mid, atk, def, gkPower };
    };

    const selectPlayerByStatAndRating = (team, statName, allowedPos = null) => {
      const candidates = Object.entries(team)
        .filter(
          ([pos, card]) => card && (!allowedPos || allowedPos.includes(pos))
        )
        .map(([pos, card]) => {
          const statVal = getStat(card, statName);
          const ovrVal = getOverall(card);

          let baseScore = statVal * 0.6 + ovrVal * 0.4;
          let weight = Math.pow(baseScore / 10, 2.5);

          if (pos === "cf" && statName === "sho") weight *= 1.8;

          return { card, weight, pos };
        });

      if (candidates.length === 0) return null;

      const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
      let random = Math.random() * totalWeight;

      for (const candidate of candidates) {
        if (random < candidate.weight) return { card: candidate.card, pos: candidate.pos };
        random -= candidate.weight;
      }
      return { card: candidates[0].card, pos: candidates[0].pos };
    };

    const homePow = getTeamPower(homeTeam);
    const awayPow = getTeamPower(awayTeam);
    const allEvents = [];

    const homeChance = homePow.mid / (homePow.mid + awayPow.mid);

    let hasUltOccurred = false;

    for (let min = 1; min <= 90; min++) {
      if (Math.random() < 0.14) {
        const isHomeAttacking = Math.random() < homeChance;
        const attackingTeam = isHomeAttacking ? homeTeam : awayTeam;
        const defendingTeam = isHomeAttacking ? awayTeam : homeTeam;
        const defStats = isHomeAttacking ? awayPow : homePow;

        const dribblerObj = selectPlayerByStatAndRating(attackingTeam, "dri", ["cm", "lf", "rf", "cf"]);
        const dribbler = dribblerObj ? dribblerObj.card : null;
        const dribblerPos = dribblerObj ? dribblerObj.pos : null;
        const dribblerUltConfig = dribbler && dribbler.ultimate ? SKILL_EFFECTS[dribbler.ultimate] : null;
        const ultChanceDribble = (!hasUltOccurred && min > 60) ? 1.0 : 0.60;

        if (
          isHomeAttacking &&
          dribbler &&
          dribbler.ultimate &&
          dribblerUltConfig &&
          dribblerUltConfig.type === "dribble" &&
          dribblerUltConfig.pos.includes(dribblerPos) &&
          Math.random() < ultChanceDribble
        ) {
          hasUltOccurred = true;
          allEvents.push({
            minute: min,
            type: "dribble_event",
            dribbler: dribbler,
            team: "home"
          });
          continue;
        }

        const defenderObj = selectPlayerByStatAndRating(defendingTeam, "def", ["lb", "rb", "cm"]);
        const defender = defenderObj ? defenderObj.card : null;
        const defenderPos = defenderObj ? defenderObj.pos : null;
        const defScore = defender ? getStat(defender, "def") * 0.6 + getOverall(defender) * 0.4 : 30;

        if (defender && Math.random() < (defScore / 200)) {
          const ultConfig = defender.ultimate ? SKILL_EFFECTS[defender.ultimate] : null;
          const ultChance = (!hasUltOccurred && min > 60) ? 1.0 : 0.60;
          const isUltActive = defender.ultimate && ultConfig && ultConfig.type === "defense" && ultConfig.pos.includes(defenderPos) && Math.random() < ultChance;
          let defEmoji = Math.random() < 0.5 ? "🧱" : "🛡️";
          let ultText = "";

          if (isUltActive) {
            hasUltOccurred = true;
            defEmoji = "<a:llamamorada:1545685043354279977>";
            ultText = `<a:llamamorada:1545685043354279977> **${defender.ultimate}** `;
          }

          allEvents.push({
            minute: min,
            text: `\`${min}'\` ${defEmoji} ${ultText}**${defender.name}**`,
            type: "defense",
            team: isHomeAttacking ? "away" : "home",
          });
          continue;
        }

        const shooterObj =
          selectPlayerByStatAndRating(attackingTeam, "sho", [
            "cf",
            "lf",
            "rf",
            "cm",
            "lb",
            "rb",
          ]) || { card: attackingTeam.cf, pos: "cf" };
        
        const shooter = shooterObj ? shooterObj.card : null;
        const shooterPos = shooterObj ? shooterObj.pos : null;
        const gk = defendingTeam.gk;

        if (!shooter) continue;

        let assistantObj = selectPlayerByStatAndRating(attackingTeam, "pas", [
          "cm",
          "lf",
          "rf",
          "lb",
          "rb",
        ]);
        if (assistantObj && assistantObj.card.card_id === shooter.card_id) assistantObj = null;

        const assistant = assistantObj ? assistantObj.card : null;
        const assistantPos = assistantObj ? assistantObj.pos : null;

        const ultChancePass = (!hasUltOccurred && min > 60) ? 1.0 : 0.65;
        const ultChanceShoot = (!hasUltOccurred && min > 60) ? 1.0 : 0.65;

        const passUltConfig = assistant && assistant.ultimate ? SKILL_EFFECTS[assistant.ultimate] : null;
        const isPassUltActive = assistant && assistant.ultimate && passUltConfig && passUltConfig.type === "pass" && passUltConfig.pos.includes(assistantPos) && Math.random() < ultChancePass;

        const shootUltConfig = shooter.ultimate ? SKILL_EFFECTS[shooter.ultimate] : null;
        const isShooterUlt = shooter.ultimate && shootUltConfig && shootUltConfig.type === "shoot" && shootUltConfig.pos.includes(shooterPos) && Math.random() < ultChanceShoot;
        
        if (isPassUltActive || isShooterUlt) {
          hasUltOccurred = true;
        }

        let shooterQuality =
          getStat(shooter, "sho") * 0.6 + getOverall(shooter) * 0.4;
        
        if (isShooterUlt) {
          shooterQuality += 20;
        }
        if (isPassUltActive) {
          shooterQuality += 15;
        }

        const shootPower = shooterQuality + (Math.random() * 16 - 8);

        const defensiveBlock = defStats.def / 10 + (Math.random() * 10 - 5);
        if (shootPower < defensiveBlock - 15) continue;

        const gkUltConfig = gk && gk.ultimate ? SKILL_EFFECTS[gk.ultimate] : null;
        const ultChanceGk = (!hasUltOccurred && min > 60) ? 1.0 : 0.65;
        const isGkUlt = gk && gk.ultimate && gkUltConfig && gkUltConfig.type === "save" && gkUltConfig.pos.includes("gk") && Math.random() < ultChanceGk;
        
        if (isGkUlt) {
          hasUltOccurred = true;
        }

        let gkQuality = gk
          ? getStat(gk, "def") * 0.4 +
            getStat(gk, "aer") * 0.3 +
            getOverall(gk) * 0.3
          : 40;

        if (isGkUlt) {
          gkQuality += 20;
        }

        const gkDefense = gkQuality + (Math.random() * 16 - 8);

        if (shootPower > gkDefense) {
          let text = "";

          if (isShooterUlt) {
            text = assistant 
              ? `\`${min}'\` ⚽ <a:llamamorada:1545685043354279977> **${shooter.ultimate}** **${shooter.name}** (${assistant.name})`
              : `\`${min}'\` ⚽ <a:llamamorada:1545685043354279977> **${shooter.ultimate}** **${shooter.name}**`;
          } else if (isPassUltActive) {
            text = `\`${min}'\` ⚽ <a:llamamorada:1545685043354279977> **${assistant.ultimate} To ${shooter.name}** (${assistant.name})`;
          } else {
            text = assistant
              ? `\`${min}'\` ⚽ **${shooter.name}** (${assistant.name})`
              : `\`${min}'\` ⚽ **${shooter.name}**`;
          }

          allEvents.push({
            minute: min,
            text,
            type: "goal",
            team: isHomeAttacking ? "home" : "away",
          });
        } else if (gk && Math.random() < 0.6) {
          let text = "";
          if (isGkUlt) {
            text = `\`${min}'\` 🧤 <a:llamamorada:1545685043354279977> **${gk.ultimate}** **${gk.name}**`;
          } else if (isPassUltActive) {
            text = `\`${min}'\` 🧤 **${gk.name}** Saved the shot after <a:llamamorada:1545685043354279977> **${assistant.ultimate} To ${shooter.name}**`;
          } else {
            text = `\`${min}'\` 🧤 **${gk.name}**`;
          }

          allEvents.push({
            minute: min,
            text,
            type: "save",
            team: isHomeAttacking ? "away" : "home",
          });
        }
      }
    }

    let currentHomeGoals = 0;
    let currentAwayGoals = 0;
    const homeHtEvents = [];
    const homeFtEvents = [];
    const awayHtEvents = [];
    const awayFtEvents = [];

    const buildEmbed = (minuteLabel, statusLabel, isFinished = false) => {
      let description = `🔵 **${homeUser.username} FC** \`${currentHomeGoals}-${currentAwayGoals}\` **${awayUser.username} FC** 🔴\n`;
      description += `Status: \`${statusLabel}\`\n\n`;

      description += `**${homeUser.username} FC**\n`;
      description += `Manager: \`${homeUser.username}\`\n\n`;
      if (homeHtEvents.length > 0) {
        description += homeHtEvents.join("\n") + "\n";
      }
      description += `------------ HT ------------\n`;
      if (homeFtEvents.length > 0) {
        description += homeFtEvents.join("\n") + "\n";
      }
      description += `------------ FT ------------\n\n`;

      description += `**${awayUser.username} FC**\n`;
      description += `Manager: \`${awayUser.username}\`\n`;
      if (awayHtEvents.length > 0) {
        description += awayHtEvents.join("\n") + "\n";
      }
      description += `------------ HT ------------\n`;
      if (awayFtEvents.length > 0) {
        description += awayFtEvents.join("\n") + "\n";
      }
      description += `------------ FT ------------\n`;

      if (isFinished) {
        description += "\n";
        if (currentHomeGoals > currentAwayGoals) {
          description += `✅ **Result**\nYou won the match! Reward claimed.`;
        } else if (currentHomeGoals === currentAwayGoals) {
          description += `🤝 **Result**\nDraw! Both teams share points.`;
        } else {
          description += `❌ **Result**\nYou lost the match, no reward this time.`;
        }
      }

      return new EmbedBuilder()
        .setTitle(`${homeUser.username} vs ${awayUser.username}`)
        .setColor(isFinished ? "#2B2D31" : "#E67E22")
        .setDescription(description);
    };

    try {
      for (let min = 1; min <= 90; min++) {
        while (allEvents.length > 0 && allEvents[0].minute === min) {
          const event = allEvents.shift();
          const isFirstHalf = event.minute <= 45;

          if (event.type === "dribble_event") {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("dribble_left")
                .setLabel("Left")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId("dribble_center")
                .setLabel("Center")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId("dribble_right")
                .setLabel("Right")
                .setStyle(ButtonStyle.Primary)
            );

            const eventEmbed = new EmbedBuilder()
              .setTitle("<a:llamaroja:1545925021376061602> Legendary Dribble!")
              .setColor("#E74C3C")
              .setDescription(
                `**${event.dribbler.name}** starts a Legendary Dribble! Which way do you cut?`
              );

            const msg = await interaction.editReply({
              embeds: [buildEmbed(`${min}'`, `Live (${min}')`), eventEmbed],
              components: [row],
            });

            const directions = ["dribble_left", "dribble_center", "dribble_right"];
            const cpuChoice = directions[Math.floor(Math.random() * directions.length)];

            try {
              const filter = (i) => i.user.id === homeUser.id;
              const confirmation = await msg.awaitMessageComponent({
                filter,
                time: 5000,
              });

              const userChoice = confirmation.customId;
              await confirmation.deferUpdate().catch(() => {});

              if (userChoice !== cpuChoice) {
                // Seleccionar al delantero/atacante que recibe la asistencia
                const shooterObj =
                  selectPlayerByStatAndRating(homeTeam, "sho", ["cf", "lf", "rf", "cm"]) ||
                  { card: homeTeam.cf || event.dribbler };

                const shooter = shooterObj.card;

                // Texto del regate legendario
                const dribbleText = `\`${min}'\` <a:llamaroja:1545925021376061602> **${event.dribbler.ultimate}** **${event.dribbler.name}** breaks the defender's ankles and assists for an easy goal!`;
                
                // Texto clásico de gol con el rematador y la asistencia
                const goalText = `\`${min}'\` ⚽ **${shooter.name}** (${event.dribbler.name})`;

                currentHomeGoals++;

                if (isFirstHalf) {
                  homeHtEvents.push(dribbleText);
                  homeHtEvents.push(goalText);
                } else {
                  homeFtEvents.push(dribbleText);
                  homeFtEvents.push(goalText);
                }
              } else {
                const text = `\`${min}'\` 🛑 **${event.dribbler.name}** attempted a Legendary Dribble but was read and tackled.`;
                if (isFirstHalf) homeHtEvents.push(text);
                else homeFtEvents.push(text);
              }
            } catch (err) {
              const text = `\`${min}'\` 🛑 **${event.dribbler.name}** hesitated for too long and lost the opportunity to dribble.`;
              if (isFirstHalf) homeHtEvents.push(text);
              else homeFtEvents.push(text);
            }

            await interaction.editReply({
              embeds: [buildEmbed(`${min}'`, `Live (${min}')`)],
              components: [],
            });
            continue;
          }

          if (event.team === "home") {
            if (event.type === "goal") currentHomeGoals++;
            if (isFirstHalf) homeHtEvents.push(event.text);
            else homeFtEvents.push(event.text);
          } else {
            if (event.type === "goal") currentAwayGoals++;
            if (isFirstHalf) awayHtEvents.push(event.text);
            else awayFtEvents.push(event.text);
          }
        }

        if (min === 45) {
          await interaction.editReply({
            embeds: [buildEmbed("45'", "Halftime")],
          });
          await sleep(4000);
          continue;
        }

        if (min === 90) {
          await interaction.editReply({
            embeds: [buildEmbed("90'", "Final", true)],
          });
          break;
        }

        await interaction.editReply({
          embeds: [buildEmbed(`${min}'`, `Live (${min}')`)],
        });

        await sleep(500);
      }
    } catch (err) {
      console.error("Error during match simulation:", err);
    }
  }

  if (interaction.commandName === "sell") {
    try {
      await interaction.deferReply({ flags: 64 });

      const userId = interaction.user.id;
      const playerNameInput = interaction.options.getString("player").trim();
      const monedaIcon = "<:moneda:1545283928515022909>";

      const item = db
        .prepare(
          `
                SELECT inventory.id as inventory_id, cards.* 
                FROM inventory 
                JOIN cards ON inventory.card_id = cards.card_id 
                WHERE inventory.user_id = ? AND LOWER(cards.name) = LOWER(?)
                LIMIT 1
            `
        )
        .get(userId, playerNameInput);

      if (!item) {
        return interaction.editReply({
          content: `❌ You do not own any card named \`${playerNameInput}\` in your inventory.`,
        });
      }

      let user = db
        .prepare("SELECT * FROM users WHERE user_id = ?")
        .get(userId);
      if (!user) {
        db.prepare(
          "INSERT INTO users (user_id, coins, last_claim) VALUES (?, ?, ?)"
        ).run(userId, 0, 0);
      }

      db.prepare("DELETE FROM inventory WHERE id = ?").run(item.inventory_id);

      db.prepare("UPDATE users SET coins = coins + ? WHERE user_id = ?").run(
        item.price,
        userId
      );

      const squad = db
        .prepare("SELECT * FROM squads WHERE user_id = ?")
        .get(userId);
      if (squad) {
        const positions = [
          "gk_id",
          "lb_id",
          "rb_id",
          "cm_id",
          "lf_id",
          "cf_id",
          "rf_id",
        ];
        positions.forEach((pos) => {
          if (squad[pos] === item.card_id) {
            const remainingCopy = db
              .prepare(
                "SELECT * FROM inventory WHERE user_id = ? AND card_id = ?"
              )
              .get(userId, item.card_id);
            if (!remainingCopy) {
              db.prepare(
                `UPDATE squads SET ${pos} = NULL WHERE user_id = ?`
              ).run(userId);
            }
          }
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`💰 Card Sold Successfully!`)
        .setColor("#2ECC71")
        .setDescription(
          `You have sold \`${item.name}\` for its market value.`
        )
        .addFields(
          { name: "Player", value: `\`${item.name}\``, inline: true },
          { name: "Position", value: `\`${item.pos}\``, inline: true },
          { name: "OVR", value: `\`${item.overall}\``, inline: true },
          {
            name: "Sell Price",
            value: `${monedaIcon} \`${formatPrice(item.price)}\``,
            inline: true,
          }
        )
        .setFooter({ text: `Sold by ${interaction.user.username}` });

      const files = [];
      const cardImgSrc = item.image_url || item.image;
      if (cardImgSrc) {
        try {
          if (cardImgSrc.startsWith("http")) {
            embed.setImage(encodeURI(cardImgSrc));
          } else {
            const imagePath = path.join(__dirname, "assets", path.basename(cardImgSrc));
            if (fs.existsSync(imagePath)) {
              const attachment = new AttachmentBuilder(imagePath, {
                name: path.basename(cardImgSrc),
              });
              files.push(attachment);
              embed.setImage(`attachment://${path.basename(cardImgSrc)}`);
            }
          }
        } catch (err) {
          console.error(`❌ Error rendering image in /sell (${item.name}):`, err);
        }
      }

      await interaction.editReply({ embeds: [embed], files: files });
    } catch (error) {
      console.error("Error in /sell:", error);
      const errorMsg = "❌ A database error occurred while trying to sell the card.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMsg }).catch(console.error);
      } else {
        await interaction.reply({ content: errorMsg, flags: 64 }).catch(console.error);
      }
    }
  }

  if (interaction.commandName === "remove") {
    try {
      const userId = interaction.user.id;
      const playerNameInput = interaction.options.getString("player").trim();

      const squad = db
        .prepare("SELECT * FROM squads WHERE user_id = ?")
        .get(userId);
      if (!squad) {
        return interaction.reply({
          content: "❌ You don't have a squad created yet.",
          flags: 64,
        });
      }

      const positions = [
        "gk_id",
        "lb_id",
        "rb_id",
        "cm_id",
        "lf_id",
        "cf_id",
        "rf_id",
      ];
      let targetPosition = null;
      let playerFound = null;

      for (const pos of positions) {
        if (squad[pos]) {
          const card = db
            .prepare(
              "SELECT * FROM cards WHERE card_id = ? AND LOWER(name) = LOWER(?)"
            )
            .get(squad[pos], playerNameInput);
          if (card) {
            targetPosition = pos;
            playerFound = card;
            break;
          }
        }
      }

      if (!playerFound) {
        return interaction.reply({
          content: `❌ \`${playerNameInput}\` is not currently in your starting lineup.`,
          flags: 64,
        });
      }

      db.prepare(
        `UPDATE squads SET ${targetPosition} = NULL WHERE user_id = ?`
      ).run(userId);

      return interaction.reply({
        content: `✅ \`${playerFound.name}\` [\`${playerFound.pos}\`] has been removed from your starting lineup.`,
      });
    } catch (error) {
      console.error("Error in /remove:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while trying to remove the player.",
          flags: 64,
        });
      }
    }
  }

  if (interaction.commandName === "shop") {
    try {
      const userId = interaction.user.id;
      const buyInput = interaction.options.getString("buy");

      const coinIcon = "<:moneda:1545283928515022909>";
      const timerIcon = "⌛";
      const store = "<:tienda:1545274823201132575>";

      let user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
      if (!user) {
        db.prepare("INSERT INTO users (user_id, coins, last_claim) VALUES (?, ?, ?)").run(userId, 0, 0);
        user = { user_id: userId, coins: 0, last_claim: 0 };
      }

      if (buyInput) {
        const query = buyInput.trim().toLowerCase();

        const selectedPack = shopPacks.find(
          (p) => p.id.toLowerCase() === query || p.name.toLowerCase().includes(query)
        );

        if (!selectedPack) {
          return interaction.reply({
            content: `❌ \`${buyInput}\` is not a valid pack. Options: \`mythic\`, \`legendary\`, \`epic\`, \`rare\`, \`common\`.`,
            flags: 64,
          });
        }

        if (user.coins < selectedPack.price) {
          return interaction.reply({
            content: `❌ Not enough coins. **${selectedPack.name}** costs ${coinIcon} \`${formatPrice(selectedPack.price)}\` and you have ${coinIcon} \`${formatPrice(user.coins)}\`.`,
            flags: 64,
          });
        }

        let availableCards = db
          .prepare("SELECT * FROM cards WHERE overall BETWEEN ? AND ?")
          .all(selectedPack.minOvr, selectedPack.maxOvr);

        if (!availableCards || availableCards.length === 0) {
          return interaction.reply({
            content: `❌ No cards registered in the database for the range [${selectedPack.minOvr} - ${selectedPack.maxOvr} OVR].`,
            flags: 64,
          });
        }

        const obtainedCard = availableCards[Math.floor(Math.random() * availableCards.length)];

        db.prepare("UPDATE users SET coins = coins - ? WHERE user_id = ?").run(
          selectedPack.price,
          userId
        );
        db.prepare("INSERT INTO inventory (user_id, card_id) VALUES (?, ?)").run(
          userId,
          obtainedCard.card_id
        );

        const cardEmbed = new EmbedBuilder()
          .setTitle(`🎉 You opened a ${selectedPack.name}!`)
          .setDescription(
            `You pulled: **${obtainedCard.name}**!\n\n` +
            `**Position:** \`${obtainedCard.pos}\`\n` +
            `**Overall (OVR):** \`${obtainedCard.overall}\`\n` +
            `**Market Value:** ${coinIcon} \`${formatPrice(obtainedCard.price)}\``
          )
          .setColor("#2B2D31");

        const replyPayload = { embeds: [cardEmbed] };
        const cardImage = obtainedCard.image_url || obtainedCard.image;

        if (cardImage) {
          try {
            if (cardImage.startsWith("http")) {
              cardEmbed.setImage(encodeURI(cardImage));
            } else {
              const imagePath = path.join(__dirname, "assets", path.basename(cardImage));
              if (fs.existsSync(imagePath)) {
                cardEmbed.setImage(`attachment://${path.basename(cardImage)}`);
                replyPayload.files = [{ attachment: imagePath, name: path.basename(cardImage) }];
              }
            }
          } catch (err) {
            console.error(`❌ Error rendering shop card image (${obtainedCard.name}):`, err);
          }
        }

        return interaction.reply(replyPayload);
      }

      const nextHour = new Date();
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      const nextHourUnix = Math.floor(nextHour.getTime() / 1000);

      let descriptionText =
        `Welcome to the RLS Shop\n` +
        `Purchase packs by typing: \`/shop buy: <pack_id>\`\n\n` +
        `${timerIcon} **Resets in:** <t:${nextHourUnix}:R>\n` +
        `${coinIcon} **Balance:** \`${formatPrice(user.coins)}\`\n\n` +
        `**Item List**\n`;

      shopPacks.forEach((pack) => {
        descriptionText +=
          `${pack.icon} **${pack.name}** [\`${pack.minOvr} - ${pack.maxOvr} OVR\`] - **${formatPrice(pack.price)}** ${coinIcon}\n` +
          `> ${pack.description}\n\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`${store} RLS Bot Shop`)
        .setColor("#2B2D31")
        .setDescription(descriptionText);

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error("Error in /shop:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while opening the shop.",
          flags: 64,
        });
      }
    }
  }

  if (interaction.commandName === "profile") {
    try {
      const userId = interaction.user.id;
      const monedaIcon = "<:moneda:1545283928515022909>";

      let user = db
        .prepare("SELECT * FROM users WHERE user_id = ?")
        .get(userId);
      const coins = user ? user.coins || 0 : 0;

      const totalInventory = db
        .prepare("SELECT COUNT(*) as count FROM inventory WHERE user_id = ?")
        .get(userId).count;

      const clubValueRow = db
        .prepare(
          `
                SELECT SUM(cards.price) as total_value 
                FROM inventory 
                JOIN cards ON inventory.card_id = cards.card_id 
                WHERE inventory.user_id = ?
            `
        )
        .get(userId);

      const clubValue = clubValueRow.total_value || 0;

      const embed = new EmbedBuilder()
        .setTitle(`👤 Manager Profile - ${interaction.user.username}`)
        .setColor("#3498DB")
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          {
            name: `${monedaIcon} Coins`,
            value: `\`${formatPrice(coins)}\``,
            inline: true,
          },
          {
            name: "🎒 Club Players",
            value: `\`${totalInventory}\` cards`,
            inline: true,
          },
          {
            name: "💼 Club Value",
            value: `${monedaIcon} \`${formatPrice(clubValue)}\``,
            inline: false,
          }
        )
        .setFooter({ text: "RLS Guru System" });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error("Error in /profile:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred loading your profile.",
          flags: 64,
        });
      }
    }
  }

  if (interaction.commandName === "fuse") {
    try {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const playerNameInput = interaction.options.getString("player").trim();
      const monedaIcon = "<:moneda:1545283928515022909>";
      const habilities = "<:estrella:1545228638822203412>";

      const userCopies = db
        .prepare(
          `
          SELECT inventory.id as inventory_id, cards.* 
          FROM inventory 
          JOIN cards ON inventory.card_id = cards.card_id 
          WHERE inventory.user_id = ? AND LOWER(cards.name) = LOWER(?)
          `
        )
        .all(userId, playerNameInput);

      if (!userCopies || userCopies.length < 3) {
        const currentAmount = userCopies ? userCopies.length : 0;
        return interaction.editReply({
          content: `❌ You need at least **3 copies** of \`${playerNameInput}\` to perform a fusion. You currently own **${currentAmount}**.`,
        });
      }

      const baseCard = userCopies[0];

      let targetCards = db
        .prepare("SELECT * FROM cards WHERE overall > ? ORDER BY overall ASC")
        .all(baseCard.overall);

      if (!targetCards || targetCards.length === 0) {
        targetCards = db
          .prepare("SELECT * FROM cards WHERE overall = (SELECT MAX(overall) FROM cards)")
          .all();
      }

      const newCard = targetCards[Math.floor(Math.random() * targetCards.length)];

      const deleteStmt = db.prepare("DELETE FROM inventory WHERE id = ?");
      const copiesToDelete = userCopies.slice(0, 3);
      
      for (const copy of copiesToDelete) {
        deleteStmt.run(copy.inventory_id);
      }

      db.prepare("INSERT INTO inventory (user_id, card_id) VALUES (?, ?)").run(
        userId,
        newCard.card_id
      );

      const packIcon = getPackIconByOvr(newCard.overall);
      const categoryStarsDisplay = getCategoryStars(newCard.category);

      const embed = new EmbedBuilder()
        .setTitle(`⚡ Fusion Successful! You obtained ${newCard.name}! ${packIcon}`)
        .setColor("#9B59B6")
        .setDescription(`You sacrificed 3x **${baseCard.name}** (${baseCard.overall} OVR) to forge a higher tier card!`)
        .addFields(
          { name: "POS", value: `\`${newCard.pos}\``, inline: true },
          { name: "OVR", value: `\`${newCard.overall}\``, inline: true },
          { name: "Rarity", value: `\`${newCard.rarity ? newCard.rarity.toUpperCase() : "N/A"}\``, inline: true },
          { name: "Category", value: `${categoryStarsDisplay}`, inline: true },
          { name: `${habilities}Passive`, value: `\`${newCard.passive || "None"}\``, inline: false },
          { name: `${habilities}Ultimate`, value: `\`${newCard.ultimate || "None"}\``, inline: false },
          {
            name: "Market Value",
            value: `${monedaIcon} \`${formatPrice(newCard.price)}\``,
            inline: false,
          }
        );

      const files = [];
      const cardImage = newCard.image_url || newCard.image;
      if (cardImage) {
        try {
          if (cardImage.startsWith("http")) {
            embed.setImage(encodeURI(cardImage));
          } else {
            const imagePath = path.join(__dirname, "assets", path.basename(cardImage));
            if (fs.existsSync(imagePath)) {
              const attachment = new AttachmentBuilder(imagePath, { name: path.basename(cardImage) });
              files.push(attachment);
              embed.setImage(`attachment://${path.basename(cardImage)}`);
            }
          }
        } catch (err) {
          console.error(`❌ Error rendering fusion card image (${newCard.name}):`, err);
        }
      }

      await interaction.editReply({ embeds: [embed], files });
    } catch (error) {
      console.error("Error in /fuse:", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "❌ An error occurred while fusing the cards.",
        });
      } else {
        await interaction.reply({
          content: "❌ An error occurred while fusing the cards.",
          flags: 64,
        });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);