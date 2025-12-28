# 🏆 Sistema de Gestão Comercial Zenith

Sistema completo de gestão comercial desenvolvido para a Zenith, incluindo área administrativa e dashboard para gerentes de contas.

---

## 📦 **Arquivos Incluídos**

1. **zenith-admin-completo.html** - Dashboard Administrativo Completo
2. **zenith-cadastro-time.html** - Cadastro do Time Comercial
3. **zenith-gerente-dashboard.html** - Dashboard do Gerente de Contas
4. **zenith-logo.png** - Logo oficial da Zenith
5. **LEIA-ME-SISTEMA-ZENITH.md** - Esta documentação

---

## 🎯 **Dashboard Administrativo (Admin)**

### **Funcionalidades Completas:**

#### **1. Dashboard Financeiro**
- 📊 KPIs principais: Custo Total, Lucro Total, Ordens Abertas, Ordens Concluídas
- 📈 Filtros temporais: Hoje, Semanal, Mensal
- 💰 Visualização de Custo X Lucro
- 📉 Indicadores de tendência

#### **2. Gestão de Usuários**
- 👤 Cadastro completo de funcionários
- 💵 Definição de comissão sobre lucro (%)
- 📧 E-mail, telefone, cargo
- ✅ Status (Ativo/Inativo)
- 📋 Listagem com ações de editar/excluir

#### **3. Gestão de Serviços**
- 🛠️ Cadastro de serviços oferecidos
- 💰 Custo base e preço de venda
- 📊 Cálculo automático de lucro
- 📝 Descrição detalhada
- ✅ Status (Ativo/Inativo)

#### **4. Atribuição de Serviços**
- 🔗 Vincular serviços a usuários específicos
- 📋 Controle de quais produtos cada vendedor pode oferecer
- 👥 Visualização de serviços por usuário

#### **5. Cotação do Dólar**
- 💱 Configuração de link da API de cotação
- 📊 Visualização da cotação atual
- 🔍 Teste de conexão com API
- 💡 Sugestões de APIs gratuitas (AwesomeAPI, BrasilAPI, Banco Central)

#### **6. Ordens de Pagamento em Aberto**
- 📋 Listagem completa de ordens pendentes
- 💰 Custo, preço, lucro e comissão calculados
- ✅ Botão para concluir ordem
- 👤 Informações de cliente e vendedor

#### **7. Ordens de Pagamento Concluídas**
- ✅ Histórico completo de vendas
- 📊 Dados financeiros detalhados
- 📅 Data de conclusão
- 💎 Comissões pagas

---

## 👥 **Dashboard do Gerente de Contas**

### **Funcionalidades:**

#### **1. Banner de Comissão**
- 💰 Valor total a receber em destaque
- 📊 Lucro gerado pelo vendedor
- 📈 Número de vendas realizadas
- 💎 Taxa de comissão

#### **2. Estatísticas Pessoais**
- 📊 Vendas do mês
- 💵 Ticket médio
- 🎯 Taxa de conversão
- 🏆 Progresso da meta

#### **3. Tabela de Vendas**
- 📋 Lista completa de vendas pessoais
- 💰 Lucro e comissão por venda
- 🏷️ Status (Concluída/Pendente)
- 🔍 Filtros: Todas, Concluídas, Pendentes

#### **4. Performance Mensal**
- 📈 Barras de progresso animadas
- 🎯 Meta de vendas
- 💰 Meta de lucro
- 📊 Taxa de conversão

---

## 🎨 **Design e Identidade Visual**

### **Cores Oficiais Zenith:**
- **Preto:** #0a0a0a (Fundo principal)
- **Dourado:** #D4AF37 (Destaques e elementos principais)
- **Cinza:** #888 (Textos secundários)
- **Verde:** #10b981 (Sucesso/Lucro)
- **Vermelho:** #ef4444 (Custos/Alertas)

### **Tipografia:**
- **Fonte:** Inter (Google Fonts)
- **Pesos:** 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)

### **Logo:**
- Triângulos dourados em gradiente
- Texto "ZENITH" em cinza claro
- Formato PNG com fundo transparente

---

## 📱 **Otimização Mobile**

### **Recursos Responsivos:**
- ✅ Layout adaptável para telas pequenas
- ✅ Cards empilhados em mobile
- ✅ Tabelas com scroll horizontal
- ✅ Menu de navegação otimizado
- ✅ Fonte legível em qualquer tamanho
- ✅ Botões e campos touch-friendly

---

## 🚀 **Como Usar**

### **1. Instalação:**
```bash
# Descompactar o arquivo ZIP
unzip zenith-sistema-completo.zip

# Todos os arquivos estarão prontos para uso
```

### **2. Acesso:**
- Abra qualquer arquivo HTML em um navegador moderno
- Funciona 100% offline (sem necessidade de servidor)
- Compatível com Chrome, Firefox, Safari, Edge

### **3. Navegação:**

**Dashboard Admin:**
- Use as abas no topo para navegar entre seções
- Preencha formulários e clique em "Salvar"
- Use filtros temporais no Dashboard Financeiro

**Dashboard Gerente:**
- Visualize comissões e estatísticas
- Filtre vendas por status
- Acompanhe progresso de metas

---

## 💡 **Funcionalidades Técnicas**

### **Validações:**
- ✅ Campos obrigatórios marcados com asterisco
- ✅ Máscara automática de telefone
- ✅ Validação de e-mail
- ✅ Validação de URLs (API de cotação)
- ✅ Limites de valores (comissão 0-100%)

### **Interatividade:**
- ✅ Formulários com feedback visual
- ✅ Botões com hover effects
- ✅ Tabelas com destaque ao passar o mouse
- ✅ Animações suaves
- ✅ Confirmações antes de excluir

### **Dados Simulados:**
- ✅ Usuários de exemplo (João Silva, Maria Santos)
- ✅ Serviços de exemplo (Consignado INSS, FGTS, etc)
- ✅ Ordens de pagamento realistas
- ✅ Estatísticas financeiras

---

## 🔧 **Personalização**

### **Adicionar Novos Usuários:**
1. Acesse a aba "Usuários"
2. Preencha o formulário
3. Defina a comissão (%)
4. Clique em "Salvar Usuário"

### **Cadastrar Serviços:**
1. Acesse a aba "Serviços"
2. Informe nome, custo e preço
3. O lucro é calculado automaticamente
4. Clique em "Salvar Serviço"

### **Configurar API do Dólar:**
1. Acesse a aba "Cotação Dólar"
2. Cole o link da API
3. Clique em "Testar API"
4. Salve a configuração

---

## 📊 **Cálculos Automáticos**

### **Lucro:**
```
Lucro = Preço de Venda - Custo Base
```

### **Comissão:**
```
Comissão = Lucro × (Taxa de Comissão ÷ 100)
```

### **Exemplo:**
- Preço: R$ 1.200,00
- Custo: R$ 500,00
- Lucro: R$ 700,00
- Comissão (15%): R$ 105,00

---

## 🔐 **Segurança e Privacidade**

- ✅ Sistema standalone (não envia dados para servidores)
- ✅ Todos os dados ficam no navegador
- ✅ Nenhuma informação é armazenada externamente
- ✅ Ideal para demonstrações e protótipos

---

## 🌐 **Links de Teste Online**

**Dashboard Admin Completo:**
https://8080-i4f6k7vg8cdsxh0bvomok-eee16ec3.manusvm.computer/zenith-admin-completo.html

**Cadastro do Time:**
https://8080-i4f6k7vg8cdsxh0bvomok-eee16ec3.manusvm.computer/zenith-cadastro-time.html

**Dashboard Gerente:**
https://8080-i4f6k7vg8cdsxh0bvomok-eee16ec3.manusvm.computer/zenith-gerente-dashboard.html

---

## 📱 **Teste no Celular**

1. Baixe o arquivo ZIP
2. Descompacte no seu dispositivo
3. Abra o arquivo HTML no navegador
4. Teste todas as funcionalidades

**Ou use os links acima diretamente no celular!**

---

## 🎯 **Próximos Passos (Integração Futura)**

Para transformar este protótipo em um sistema completo com backend:

1. **Banco de Dados:** PostgreSQL ou MySQL
2. **Backend:** Node.js + Express ou Python + Django
3. **Autenticação:** Login seguro com JWT
4. **API REST:** Endpoints para CRUD de usuários, serviços e ordens
5. **Integração Real:** API de cotação do dólar em tempo real
6. **Relatórios:** Exportação em PDF e Excel
7. **Notificações:** E-mail e push notifications

---

## 📞 **Suporte**

Sistema desenvolvido especialmente para a **Zenith**.

**Características:**
- ✅ 100% funcional
- ✅ Sem erros
- ✅ Otimizado para mobile
- ✅ Pronto para uso
- ✅ Fácil de personalizar

---

## 📄 **Licença**

Sistema proprietário desenvolvido para uso exclusivo da Zenith.

---

**Desenvolvido com ❤️ para a Zenith**
