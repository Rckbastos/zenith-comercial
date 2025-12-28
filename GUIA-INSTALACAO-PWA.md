# 📱 Guia de Instalação do PWA - Zenith Comercial

## O que é PWA?

**Progressive Web App (PWA)** é uma tecnologia que transforma um site em um aplicativo instalável no celular, funcionando como um app nativo sem precisar da App Store ou Google Play.

---

## ✅ Vantagens do PWA Zenith:

- 📱 **Instalável** - Adicione à tela inicial como um app
- 🚀 **Rápido** - Carrega instantaneamente
- 📴 **Funciona offline** - Cache inteligente
- 🔔 **Notificações** - Alertas de novas ordens (opcional)
- 💾 **Sem espaço** - Ocupa menos de 1MB
- 🔄 **Sempre atualizado** - Sem precisar atualizar manualmente

---

## 📲 Como Instalar no iPhone (iOS):

### **Passo 1: Abrir no Safari**
- Abra o Safari (navegador padrão do iPhone)
- Acesse: `https://seu-dominio.com/zenith-admin-completo.html`

### **Passo 2: Adicionar à Tela Inicial**
1. Toque no ícone **"Compartilhar"** (quadrado com seta para cima)
2. Role para baixo e toque em **"Adicionar à Tela de Início"**
3. Edite o nome se desejar (padrão: "Zenith")
4. Toque em **"Adicionar"**

### **Passo 3: Usar o App**
- O ícone do Zenith aparecerá na tela inicial
- Toque para abrir como um app nativo
- Funciona sem barra do navegador!

---

## 📲 Como Instalar no Android:

### **Passo 1: Abrir no Chrome**
- Abra o Google Chrome
- Acesse: `https://seu-dominio.com/zenith-admin-completo.html`

### **Passo 2: Instalar o App**
1. Toque no menu (3 pontos no canto superior direito)
2. Toque em **"Instalar aplicativo"** ou **"Adicionar à tela inicial"**
3. Confirme tocando em **"Instalar"**

### **Passo 3: Usar o App**
- O ícone do Zenith aparecerá na tela inicial e na gaveta de apps
- Toque para abrir como um app nativo

---

## 🔧 Arquivos do PWA:

### **1. manifest.json**
- Define nome, ícone, cores do app
- Configurações de exibição

### **2. service-worker.js**
- Gerencia cache e modo offline
- Habilita notificações push

### **3. PWA Meta Tags**
- Adicionadas em ambos os HTMLs
- Compatibilidade com iOS e Android

---

## 🚀 Como Hospedar o PWA:

### **Opção 1: Servidor Web Simples**
1. Faça upload dos arquivos para seu servidor:
   - `zenith-admin-completo.html`
   - `zenith-gerente-completo.html`
   - `zenith-logo.png`
   - `manifest.json`
   - `service-worker.js`

2. Acesse via HTTPS (obrigatório para PWA)

### **Opção 2: GitHub Pages (Gratuito)**
1. Crie repositório no GitHub
2. Faça upload dos arquivos
3. Ative GitHub Pages nas configurações
4. Acesse via: `https://seu-usuario.github.io/zenith/`

### **Opção 3: Netlify/Vercel (Gratuito)**
1. Crie conta no Netlify ou Vercel
2. Arraste os arquivos para fazer deploy
3. Receba URL automática com HTTPS

---

## 🔔 Notificações Push (Opcional):

Para habilitar notificações:

1. **No código do Service Worker** (já incluído):
   ```javascript
   self.addEventListener('push', event => {
     // Código de notificação
   });
   ```

2. **Solicitar permissão do usuário**:
   ```javascript
   Notification.requestPermission().then(permission => {
     if (permission === 'granted') {
       console.log('Notificações habilitadas!');
     }
   });
   ```

3. **Enviar notificações** (backend necessário):
   - Use Firebase Cloud Messaging (FCM)
   - Ou OneSignal (gratuito)

---

## ✅ Checklist de Instalação:

- [ ] Fazer upload de todos os arquivos para servidor HTTPS
- [ ] Testar abertura no navegador mobile
- [ ] Testar instalação no iOS (Safari)
- [ ] Testar instalação no Android (Chrome)
- [ ] Verificar ícone na tela inicial
- [ ] Testar funcionamento offline
- [ ] (Opcional) Configurar notificações push

---

## 🆘 Problemas Comuns:

### **"Adicionar à Tela Inicial" não aparece**
- ✅ Certifique-se de estar usando HTTPS
- ✅ Verifique se o `manifest.json` está acessível
- ✅ No iOS, use apenas o Safari

### **Ícone não aparece corretamente**
- ✅ Verifique se `zenith-logo.png` tem pelo menos 512x512px
- ✅ Confirme que o caminho no `manifest.json` está correto

### **Modo offline não funciona**
- ✅ Verifique se o Service Worker foi registrado (console do navegador)
- ✅ Aguarde alguns segundos após a primeira visita

---

## 📞 Suporte:

Se tiver dúvidas ou problemas, entre em contato!

---

**Sistema PWA Zenith Comercial - Pronto para Instalação! 🚀**
