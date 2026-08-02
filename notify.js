const admin = require("firebase-admin");

// La clé du compte de service Firebase sera stockée dans un "secret" GitHub
// (pas écrite en clair ici, pour rester sécurisée)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function envoyerNotificationsProduitsPremium() {
  const snapshot = await db
    .collection("products")
    .where("isPremium", "==", true)
    .where("premiumNotifie", "!=", true)
    .get();

  if (snapshot.empty) {
    console.log("Aucun nouveau produit premium à notifier.");
    return;
  }

  for (const doc of snapshot.docs) {
    const data = doc.data();

    const message = {
      topic: "produits_premium",
      notification: {
        title: `✨ ${data.name || "Nouveau produit"} — ${data.price ? data.price + " FCFA" : ""}`,
        body: `Découvrez ce produit en vedette sur Sirius, à ${data.city || ""}`,
        imageUrl: data.imageUrl || undefined,
      },
      android: {
        notification: {
          imageUrl: data.imageUrl || undefined,
        },
      },
      data: {
        type: "produit_premium",
        productId: doc.id,
      },
    };

    try {
      await admin.messaging().send(message);
      console.log("Notification envoyée pour :", doc.id);

      // On marque le produit comme déjà notifié pour ne pas le renvoyer au prochain passage
      await doc.ref.update({ premiumNotifie: true });
    } catch (error) {
      console.error("Erreur d'envoi pour", doc.id, ":", error);
    }
  }
}

async function envoyerNotificationsNouvellesCommandes() {
  const snapshot = await db
    .collection("orders")
    .where("status", "==", "enAttenteLocalisation")
    .where("vendeurNotifie", "!=", true)
    .get();

  if (snapshot.empty) {
    console.log("Aucune nouvelle commande à notifier.");
    return;
  }

  for (const doc of snapshot.docs) {
    const commande = doc.data();
    const sellerId = commande.sellerId;

    const vendeurDoc = await db.collection("users").doc(sellerId).get();
    const fcmToken = vendeurDoc.data()?.fcmToken;

    if (!fcmToken) {
      console.log("Pas de token FCM pour ce vendeur :", sellerId);
      continue;
    }

    const message = {
      token: fcmToken,
      notification: {
        title: "🛍️ Nouvelle commande reçue !",
        body: `Un client a commandé ${commande.productName || "un produit"} — ${commande.productPrice || 0} FCFA.`,
      },
      data: {
        type: "nouvelle_commande",
        orderId: doc.id,
        productId: commande.productId || "",
      },
    };

    try {
      await admin.messaging().send(message);
      console.log("Notification vendeur envoyée pour la commande :", doc.id);
      await doc.ref.update({ vendeurNotifie: true });
    } catch (error) {
      console.error("Erreur d'envoi pour la commande", doc.id, ":", error);
    }
  }
}

async function main() {
  await envoyerNotificationsProduitsPremium();
  await envoyerNotificationsNouvellesCommandes();
}

main()
  .then(() => {
    console.log("Vérification terminée.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erreur générale :", err);
    process.exit(1);
  });
