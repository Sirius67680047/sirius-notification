const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

cloudinary.config(true);

async function uploaderImageBase64(base64String, productId) {
  try {
    const dataUri = `data:image/jpeg;base64,${base64String}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "sirius_premium",
      public_id: productId,
      overwrite: true,
    });
    return result.secure_url;
  } catch (error) {
    console.error("Erreur upload Cloudinary pour", productId, ":", error.message);
    return null;
  }
}

async function envoyerNotificationsProduitsPremium() {
  const snapshot = await db
    .collection("products")
    .where("isPremium", "==", true)
    .get();

  const produitsANotifier = snapshot.docs.filter(doc => doc.data().premiumNotifie !== true);

  if (produitsANotifier.length === 0) {
    console.log("Aucun nouveau produit premium à notifier.");
    return;
  }

  for (const doc of produitsANotifier) {
    const data = doc.data();

    let imageUrl = data.imageUrl;
    if (!imageUrl && data.imageBase64) {
      console.log("Upload de l'image vers Cloudinary pour :", doc.id);
      imageUrl = await uploaderImageBase64(data.imageBase64, doc.id);
    }

    const message = {
      topic: "produits_premium",
      notification: {
        title: `✨ ${data.name || "Nouveau produit"} — ${data.price ? data.price + " FCFA" : ""}`,
        body: `Découvrez ce produit en vedette sur Sirius, à ${data.city || ""}`,
        imageUrl: imageUrl || undefined,
      },
      android: {
        notification: {
          imageUrl: imageUrl || undefined,
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

      await doc.ref.update({
        premiumNotifie: true,
        imageUrl: imageUrl || null,
      });
    } catch (error) {
      console.error("Erreur d'envoi pour", doc.id, ":", error);
    }
  }
}

async function envoyerNotificationsNouvellesCommandes() {
  const snapshot = await db
    .collection("orders")
    .where("status", "==", "enAttenteLocalisation")
    .get();

  const commandesANotifier = snapshot.docs.filter(doc => doc.data().vendeurNotifie !== true);

  if (commandesANotifier.length === 0) {
    console.log("Aucune nouvelle commande à notifier.");
    return;
  }

  for (const doc of commandesANotifier) {
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
