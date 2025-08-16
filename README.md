# 🤖 Rotary AI Sammanfattningssystem

> Automatisk AI-driven sammanfattning av Rotary Club föredrag via e-postanalys

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/rotary-ai)

## 🎯 Översikt

Detta system läser automatiskt e-post från `ai@luvi.se`, analyserar bilagor (bilder, presentationer, ljud) med AI, och genererar professionella sammanfattningar i två format:
- **Version A:** Detaljerad e-post för medlemmar (300-400 ord)
- **Version B:** Kort Facebook-inlägg (80-120 ord)

## ✨ Funktioner

- 📧 **Automatisk e-postläsning** från ai@luvi.se via IMAP
- 🔍 **Bildigenkänning** med OCR för att extrahera text och identifiera föredragshållare
- 📄 **Dokumentanalys** av PDF och Word-filer
- 🎵 **Ljudtranskribering** (Whisper-ready)
- 🤖 **Claude AI sammanfattningar** med professionell ton
- 📱 **Webb-interface** för enkel hantering
- 🔄 **Automatisk polling** var 10:e minut
- 🌍 **Molnbaserad** deployment

## 🚀 En-klicks Deployment (Rekommenderat)

### Steg 1: Klicka på deploy-knappen
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/rotary-ai)

### Steg 2: Konfigurera miljövariabler i Railway
Lägg till dessa i Railway's miljövariabel-sektion:

```env
EMAIL_USER=ai@luvi.se
EMAIL_PASSWORD=Jsy7j4kfvjg!
EMAIL_HOST=mailcluster.loopia.se
EMAIL_PORT=993
CLAUDE_API_KEY=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
NODE_ENV=production
```

### Steg 3: Deployment sker automatiskt!
Railway bygger och startar applikationen automatiskt. Du får en URL som `https://rotary-ai-xxx.railway.app`

## 🛠️ Manuell Installation (Avancerat)

Om du vill köra lokalt eller på egen server:

```bash
# Klona repository
git clone https://github.com/rotary-luvi/ai-system.git
cd ai-system

# Installera dependencies
npm install

# Skapa .env fil
cp .env.example .env
# Redigera .env med dina uppgifter

# Starta utvecklingsserver
npm run dev

# Eller produktionsserver
npm start
```

## 🔧 Miljövariabler

| Variabel | Beskrivning | Standardvärde |
|----------|-------------|---------------|
| `EMAIL_USER` | E-post användarnamn | ai@luvi.se |
| `EMAIL_PASSWORD` | E-post lösenord | [ditt lösenord] |
| `EMAIL_HOST` | IMAP server | mailcluster.loopia.se |
| `EMAIL_PORT` | IMAP port | 993 |
| `CLAUDE_API_KEY` | Claude AI API nyckel | [obligatorisk] |
| `NODE_ENV` | Miljö | production |
| `PORT` | Server port | 3001 |

## 🎮 Användning

### Webgränssnitt
Öppna din Railway URL i webbläsaren för att:
- Se anslutningsstatus
- Hantera inkommande e-post
- Bearbeta e-post med AI
- Kopiera genererade sammanfattningar

### API Endpoints

#### Grundläggande
```bash
GET /                    # Webgränssnitt
GET /api/status         # Systemstatus
GET /health             # Hälsokontroll
```

#### E-post hantering
```bash
POST /api/connect       # Anslut till e-post
GET /api/emails         # Hämta e-post
POST /api/process-email/:id  # Bearbeta specifik e-post
```

#### Distribution
```bash
POST /api/facebook-publish  # Publicera till Facebook
POST /api/send-email        # Skicka e-post till medlemmar
```

### Exempel API-anrop
```javascript
// Anslut till e-post
const response = await fetch('/api/connect', { method: 'POST' });

// Hämta e-post
const emails = await fetch('/api/emails').then(r => r.json());

// Bearbeta e-post med AI
const formData = new FormData();
formData.append('attachments', file);
const result = await fetch(`/api/process-email/${emailId}`, {
  method: 'POST',
  body: formData
});
```

## 🔄 Automatisk Funktionalitet

Systemet kör automatiskt:
- **E-postkontroll** var 10:e minut
- **Auto-anslutning** till IMAP vid serverstart
- **Felhantering** med reconnect-logik
- **Loggar** alla aktiviteter

## 📊 Monitoring

### Loggar
Railway visar automatiskt loggar i dashboard. Kolla:
- ✅ IMAP anslutning etablerad
- 📬 Nya e-post hittade
- 🤖 AI-sammanfattningar genererade
- ❌ Eventuella fel

### Status endpoint
```bash
curl https://din-railway-url.railway.app/health
```

### Systemstatistik
Webbgränssnittet visar:
- Anslutningsstatus
- Antal bearbetade e-post
- Systemupptid
- Eventuella fel

## 🔧 Felsökning

### Vanliga problem

**1. IMAP-anslutningsfel**
```bash
# Kontrollera miljövariabler
echo $EMAIL_HOST $EMAIL_PORT $EMAIL_USER
```

**2. Claude API-fel**
- Kontrollera API-nyckel är korrekt
- Verifiera att du har krediter kvar
- Kolla API-limits på Anthropic console

**3. Filuppladdningsfel**
- Kontrollera filtyper (jpg, png, pdf, docx, mp3)
- Max filstorlek är 50MB

### Railway-specifika problem

**Deployment misslyckas:**
- Kontrollera att alla miljövariabler är satta
- Verifiera att build-kommandot är korrekt
- Kolla Railway logs för specifika fel

**Timeout-problem:**
- Railway har automatisk sleep efter inaktivitet
- Lägg till uppvakning via UptimeRobot eller liknande

## 🚀 Produktionsoptimering

### Performance
- Använd Redis för caching (lägg till senare)
- Implementera queue system för stora volymer
- Optimera bildstorlekar för snabbare OCR

### Säkerhet
- Railway ger automatisk HTTPS
- API-nycklar lagras säkert som miljövariabler
- Ingen känslig data loggas

### Skalning
- Railway skalar automatiskt vid behov
- För större volymer: överväg microservices
- Lägg till load balancing vid hög trafik

## 📱 Mobilanpassning

Webbgränssnittet är responsivt och fungerar på:
- 📱 Mobiler (iOS/Android)
- 💻 Laptops/Datorer
- 📟 Tablets

## 🔮 Framtida Funktioner

### Planerat
- [ ] OpenAI Whisper för ljudtranskribering
- [ ] Automatisk Facebook-publicering
- [ ] E-postutskick till medlemsregister
- [ ] Kalendertrophy integration
- [ ] Databas för historik
- [ ] PDF-generering av sammanfattningar

### Möjliga tillägg
- [ ] Teams/Slack integration
- [ ] Språkdetektering (svenska/engelska)
- [ ] Custom templates för sammanfattningar
- [ ] Statistik och rapporter
- [ ] Webhook-notifikationer

## 💰 Kostnad

### Railway
- **Hobby Plan:** $5/månad (rekommenderat)
- **Pro Plan:** $20/månad (för högre volymer)
- Inkluderar: hosting, automatiska backups, SSL

### Claude AI
- **Estimerat:** $5-15/månad beroende på användning
- ~$0.01 per sammanfattning

### Total månadskostnad: $10-35

## 🆘 Support

### Railway Support
- Dashboard: [railway.app](https://railway.app)
- Dokumentation: [docs.railway.app](https://docs.railway.app)
- Discord: Railway Community

### Claude API Support  
- Console: [console.anthropic.com](https://console.anthropic.com)
- Dokumentation: [docs.anthropic.com](https://docs.anthropic.com)

### Teknisk Support
- GitHub Issues: [repository issues](https://github.com/rotary-luvi/ai-system/issues)
- E-post: tech-support@rotary-luvi.se

## 📄 Licens

MIT License - Se [LICENSE](LICENSE) fil för detaljer.

## 🙏 Tack till

- **Anthropic** för Claude AI
- **Railway** för molnhosting
- **Rotary International** för inspiration
- **Open Source Community** för verktyg och bibliotek

---

## 🎉 Kom igång nu!

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/rotary-ai)

**Klicka på knappen ovan och ha ett fungerande AI-system inom 5 minuter!** 🚀
