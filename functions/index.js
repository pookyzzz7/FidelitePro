const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

// Champs de carte sûrs à exposer publiquement (design uniquement, jamais de PII).
const PUBLIC_CARD_FIELDS = [
  'id', 'shopName', 'tagline', 'category',
  'color1', 'color2', 'textColor', 'stampColor',
  'stampCount', 'shape', 'emoji', 'pattern', 'reward',
];

function resolveSlot(client, cardId) {
  const slots = Array.isArray(client.cardSlots) && client.cardSlots.length
    ? client.cardSlots
    : [{
        cardId: client.cardId,
        stampsCurrent: client.stampsCurrent || 0,
        stampsCompleted: client.stampsCompleted || 0,
        expiry: null,
      }];
  if (cardId) {
    return slots.find(s => s && s.cardId === cardId) || null;
  }
  return slots[0] || null;
}

/**
 * Renvoie uniquement la carte + la progression d'UN client précis,
 * jamais le reste de la liste clients du commerçant.
 * Appelée par carte.html (page publique, sans authentification).
 */
exports.getPublicCard = onCall(async (request) => {
  const { merchantId, code } = request.data || {};
  const cardId = request.data?.cardId || null;

  if (!merchantId || typeof merchantId !== 'string' || !code || typeof code !== 'string' ||
      merchantId.length > 128 || code.length > 128) {
    throw new HttpsError('invalid-argument', 'Paramètres invalides.');
  }

  const snap = await db.collection('merchants').doc(merchantId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Carte introuvable.');
  }
  const data = snap.data() || {};
  const clients = Array.isArray(data.clients) ? data.clients : [];
  const cards = Array.isArray(data.cards) ? data.cards : [];

  const client = clients.find(c => c && c.code === code);
  if (!client) {
    throw new HttpsError('not-found', 'Carte introuvable.');
  }

  const slot = resolveSlot(client, cardId);
  if (!slot) {
    throw new HttpsError('not-found', 'Carte introuvable.');
  }

  const card = cards.find(c => c && c.id === slot.cardId);
  if (!card) {
    throw new HttpsError('not-found', 'Carte introuvable.');
  }

  const publicCard = {};
  for (const key of PUBLIC_CARD_FIELDS) publicCard[key] = card[key] ?? null;

  // Historique filtré côté serveur : seules les lignes concernant ce client sortent.
  const activity = Array.isArray(data.activity) ? data.activity : [];
  const history = activity
    .filter(a => a && a.text && client.name && a.text.includes(client.name))
    .slice(0, 5)
    .map(a => ({ icon: a.icon, text: a.text, color: a.color, time: a.time }));

  return {
    card: publicCard,
    client: {
      code: client.code,
      name: client.name || null,
      prenom: client.prenom || null,
      createdAt: client.createdAt || null,
    },
    slot: {
      cardId: slot.cardId,
      stampsCurrent: slot.stampsCurrent || 0,
      stampsCompleted: slot.stampsCompleted || 0,
      expiry: slot.expiry || null,
    },
    history,
  };
});

/**
 * Vue d'ensemble pour l'éditeur du logiciel : liste assainie de tous les
 * commerçants (jamais leurs clients). Réservée aux UID présents dans
 * la collection admins/.
 */
exports.adminListMerchants = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Connexion requise.');
  }

  const adminDoc = await db.collection('admins').doc(request.auth.uid).get();
  if (!adminDoc.exists) {
    throw new HttpsError('permission-denied', 'Accès refusé.');
  }

  const snap = await db.collection('merchants').get();
  const merchants = snap.docs.map(doc => {
    const d = doc.data() || {};
    const cards = Array.isArray(d.cards) ? d.cards : [];
    const clients = Array.isArray(d.clients) ? d.clients : [];
    const activity = Array.isArray(d.activity) ? d.activity : [];
    return {
      id: doc.id,
      shopName: d.shopName || '',
      ownerName: d.ownerName || '',
      email: d.email || '',
      createdAt: d.createdAt || null,
      cardCount: cards.length,
      clientCount: clients.length,
      lastActivity: activity[0]?.time || null,
    };
  });

  return { merchants };
});
