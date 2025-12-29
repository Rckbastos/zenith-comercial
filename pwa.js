(() => {
    const serviceWorkerPath = 'service-worker.js';

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register(serviceWorkerPath)
                .then(registration => {
                    console.log('Service Worker registrado:', registration.scope);
                })
                .catch(error => {
                    console.log('Falha ao registrar Service Worker:', error);
                });
        });
    }

    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredPrompt = event;
        console.log('PWA pronto para instalar');
    });

    window.addEventListener('appinstalled', () => {
        console.log('PWA instalado com sucesso!');
        deferredPrompt = null;
    });

    window.requestPWAInstall = async () => {
        if (!deferredPrompt) {
            return false;
        }

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        return outcome === 'accepted';
    };
})();
