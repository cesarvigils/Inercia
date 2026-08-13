import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/* =========================================================
   FIREBASE ADMIN
   ========================================================= */

const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY
} = process.env;

if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_CLIENT_EMAIL ||
    !FIREBASE_PRIVATE_KEY
) {
    console.error('\n❌ Faltan variables de Firebase Admin.\n');

    console.error(
        'Necesitás:\n' +
        'FIREBASE_PROJECT_ID\n' +
        'FIREBASE_CLIENT_EMAIL\n' +
        'FIREBASE_PRIVATE_KEY\n'
    );

    process.exit(1);
}

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
    });
}

const db = getFirestore();


/* =========================================================
   LOGGER
   ========================================================= */

function log(message) {
    console.log(`[SEED] ${message}`);
}


/* =========================================================
   SETTINGS
   ========================================================= */

async function createSettings() {
    log('Creando settings/reservations...');

    await db
        .collection('settings')
        .doc('reservations')
        .set(
            {
                standardPrice: 200,
                premiumPrice: 350,

                lateBookingFee: 20,

                minAdvanceMinutes: 30,
                lateFeeMinutes: 60,

                maxAdvanceDays: 7,
                maxDurationHours: 8,

                timezone: 'America/Tegucigalpa',

                businessHours: {
                    monday: null,

                    tuesday: {
                        open: '14:00',
                        close: '21:00'
                    },

                    wednesday: {
                        open: '14:00',
                        close: '21:00'
                    },

                    thursday: {
                        open: '14:00',
                        close: '21:00'
                    },

                    friday: {
                        open: '14:00',
                        close: '21:00'
                    },

                    saturday: {
                        open: '12:00',
                        close: '21:00'
                    },

                    sunday: {
                        open: '12:00',
                        close: '21:00'
                    }
                },

                bank: {
                    bankName: 'BAC',
                    accountName: 'Inercia S.A',
                    accountNumber: '758-610-001',
                    currency: 'HNL'
                },

                updatedAt: FieldValue.serverTimestamp()
            },
            {
                merge: true
            }
        );

    log('✅ settings/reservations creado.');
}


/* =========================================================
   STANDARD RIGS
   ========================================================= */

async function createStandardRigs() {
    log('Creando simuladores STANDARD...');

    for (let i = 1; i <= 8; i++) {
        const id = `standard-${String(i).padStart(2, '0')}`;

        await db
            .collection('rigs')
            .doc(id)
            .set(
                {
                    name: `Simulador ${i}`,
                    type: 'standard',

                    active: true,
                    maintenance: false,

                    order: i,

                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                },
                {
                    merge: true
                }
            );

        log(`   ✅ ${id} → Simulador ${i}`);
    }

    log('✅ 8 simuladores STANDARD listos.');
}


/* =========================================================
   PREMIUM RIGS
   ========================================================= */

async function createPremiumRigs() {
    log('Creando simuladores PREMIUM...');

    for (let i = 1; i <= 2; i++) {
        const id = `premium-${String(i).padStart(2, '0')}`;

        await db
            .collection('rigs')
            .doc(id)
            .set(
                {
                    name: `Simulador ${i}`,
                    type: 'premium',

                    active: true,
                    maintenance: false,

                    order: i,

                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                },
                {
                    merge: true
                }
            );

        log(`   ✅ ${id} → Simulador ${i}`);
    }

    log('✅ 2 simuladores PREMIUM listos.');
}


/* =========================================================
   TEST PROMOTION
   ========================================================= */

async function createPromotions() {
    log('Creando promoción de prueba...');

    await db
        .collection('promotions')
        .doc('martes-50')
        .set(
            {
                name: 'Martes 50%',

                active: false,

                discountType: 'percentage',
                discountValue: 50,

                /*
                 * JavaScript:
                 * Sunday = 0
                 * Monday = 1
                 * Tuesday = 2
                 */
                dayOfWeek: 2,

                appliesTo: [
                    'standard',
                    'premium'
                ],

                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            },
            {
                merge: true
            }
        );

    log('✅ Promoción martes-50 creada (DESACTIVADA).');
}


/* =========================================================
   VERIFY
   ========================================================= */

async function verifyData() {
    console.log('\n=========================================');
    console.log('           DATOS CREADOS');
    console.log('=========================================\n');

    const settings =
        await db
            .collection('settings')
            .doc('reservations')
            .get();

    console.log('⚙️ SETTINGS');

    if (settings.exists) {
        console.log(settings.data());
    } else {
        console.log('❌ No encontrados');
    }


    const rigs =
        await db
            .collection('rigs')
            .orderBy('type')
            .orderBy('order')
            .get();

    console.log('\n🏎️ RIGS');

    rigs.forEach((doc) => {
        const data = doc.data();

        console.log(
            `• ${doc.id} | ${data.type} | ${data.name} | active=${data.active} | maintenance=${data.maintenance}`
        );
    });


    const promotions =
        await db
            .collection('promotions')
            .get();

    console.log('\n🏷️ PROMOTIONS');

    promotions.forEach((doc) => {
        console.log(
            `• ${doc.id}`,
            doc.data()
        );
    });
}


/* =========================================================
   SEED
   ========================================================= */

async function seed() {
    console.log('\n=========================================');
    console.log('    SIMULADORES INERCIA - FIREBASE');
    console.log('=========================================\n');

    try {
        await createSettings();

        console.log('');

        await createStandardRigs();

        console.log('');

        await createPremiumRigs();

        console.log('');

        await createPromotions();

        await verifyData();

        console.log('\n=========================================');
        console.log('          ✅ SEED COMPLETADO');
        console.log('=========================================\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERROR EJECUTANDO EL SEED:\n');
        console.error(error);

        process.exit(1);
    }
}

seed();