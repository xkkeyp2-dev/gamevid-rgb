import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js';
import {
    getAuth,
    setPersistence,
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js';

const config = window.GAMEVID_FIREBASE_CONFIG || {};
const authForm = document.getElementById('authForm');
const authNameField = document.getElementById('authNameField');
const authNameInput = document.getElementById('authNameInput');
const authEmailInput = document.getElementById('authEmailInput');
const authPasswordInput = document.getElementById('authPasswordInput');
const authSubmitButton = document.getElementById('authSubmitButton');
const authFeedback = document.getElementById('authFeedback');
const authStatusBanner = document.getElementById('authStatusBanner');
const authUserTitle = document.getElementById('authUserTitle');
const authUserSubtitle = document.getElementById('authUserSubtitle');
const authSignOutButton = document.getElementById('authSignOutButton');
const authTabs = document.querySelectorAll('.auth-tab');

let authMode = 'login';
let authInstance = null;

function isFirebaseConfigReady() {
    return ['apiKey', 'authDomain', 'projectId', 'appId'].every((key) => {
        return typeof config[key] === 'string' && config[key] && !config[key].includes('BURAYA');
    });
}

function setFeedback(message, mode = 'default') {
    authFeedback.textContent = message;
    authFeedback.dataset.mode = mode;
}

function setBanner(message, mode = 'default') {
    authStatusBanner.textContent = message;
    authStatusBanner.dataset.mode = mode;
}

function updateMode(mode) {
    authMode = mode;
    const isRegister = mode === 'register';
    authNameField.hidden = !isRegister;
    authSubmitButton.textContent = isRegister ? 'Kayit ol' : 'Giris yap';
    authPasswordInput.autocomplete = isRegister ? 'new-password' : 'current-password';

    authTabs.forEach((tab) => {
        tab.classList.toggle('is-active', tab.dataset.authMode === mode);
    });
}

function updateUserInterface(user) {
    if (user) {
        authUserTitle.textContent = user.displayName || user.email || 'Aktif kullanici';
        authUserSubtitle.textContent = `${user.email || 'E-posta yok'} ile giris yapildi.`;
        authSignOutButton.hidden = false;
        setBanner('Hesabin aktif. Bu cihazda oturum korunuyor.', 'success');
    } else {
        authUserTitle.textContent = 'Misafir modundasin';
        authUserSubtitle.textContent = 'Kayit olunca hesabin bu cihazda oturumu korur.';
        authSignOutButton.hidden = true;
        setBanner('Giris yapinca favori deneyimlerin ayni hesapta kalir.', 'default');
    }
}

async function initAuth() {
    if (!isFirebaseConfigReady()) {
        setBanner('firebase-config.js icine Firebase web ayarlarini eklemen gerekiyor.', 'warning');
        setFeedback('Firebase konfigurasyonu eksik.', 'warning');
        authSubmitButton.disabled = true;
        return;
    }

    if (!getApps().length) {
        initializeApp(config);
    }

    authInstance = getAuth();
    await setPersistence(authInstance, browserLocalPersistence);

    onAuthStateChanged(authInstance, (user) => {
        updateUserInterface(user);
    });

    authSubmitButton.disabled = false;
    setFeedback('Hazir.', 'success');
}

authTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        updateMode(tab.dataset.authMode);
        setFeedback(authMode === 'register' ? 'Yeni hesap olusturabilirsin.' : 'Mevcut hesabinla giris yap.', 'default');
    });
});

authForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!authInstance) {
        setFeedback('Firebase hazir degil.', 'error');
        return;
    }

    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    const displayName = authNameInput.value.trim();

    authSubmitButton.disabled = true;
    setFeedback(authMode === 'register' ? 'Hesap olusturuluyor...' : 'Giris yapiliyor...', 'loading');

    try {
        if (authMode === 'register') {
            const credentials = await createUserWithEmailAndPassword(authInstance, email, password);
            if (displayName) {
                await updateProfile(credentials.user, { displayName });
            }
            setFeedback('Kayit tamamlandi. Artik giris yaptin.', 'success');
        } else {
            await signInWithEmailAndPassword(authInstance, email, password);
            setFeedback('Giris basarili.', 'success');
        }

        authForm.reset();
        if (authMode === 'register') {
            updateMode('login');
        }
    } catch (error) {
        const message = error && error.message ? error.message : 'Islem sirasinda hata olustu.';
        setFeedback(message, 'error');
    } finally {
        authSubmitButton.disabled = false;
    }
});

authSignOutButton.addEventListener('click', async () => {
    if (!authInstance) {
        return;
    }

    await signOut(authInstance);
    setFeedback('Cikis yapildi.', 'success');
});

updateMode('login');
initAuth().catch((error) => {
    console.error(error);
    setBanner('Firebase baglantisi kurulurken hata olustu.', 'error');
    setFeedback('Firebase baglantisi kurulurken hata olustu.', 'error');
});
