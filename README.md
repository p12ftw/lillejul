# 🎄 Julquiz – eget Kahoot utan teckengränser

Tre sidor:

| Sida | Vem | Vad |
|---|---|---|
| `admin.html` | Du | Logga in, skapa quiz, frågor (valfri längd), bilder, tid per fråga, rätt svar. Starta. |
| `host.html` | Storskärm/TV | PIN + QR-kod, deltagare dyker upp, frågor med nedräkning, rätt svar, topplista, pallplatser. |
| `index.html` | Deltagarna | Ange PIN + namn, svara på mobilen, se rätt/fel, poäng och placering. |

**Poäng:** rätt svar ger 500–1000 p beroende på hur snabbt man svarar, fel ger 0 p. Tiden mäts på servern, så ingen kan fuska med klockan. Frågan stängs automatiskt när alla har svarat eller tiden är slut.
**Spelomgången** (deltagare, svar, poäng) raderas när du trycker *Stäng och radera omgången* eller *Avsluta*. Dina quiz och frågor ligger kvar.

---

## Installation (ca 15 min, gratis)

### 1. Skapa Supabase-projekt
1. Gå till [supabase.com](https://supabase.com) och skapa ett konto. Välj **New project**, och som region gärna **Stockholm (eu-north-1)**.
2. Öppna **SQL Editor → New query**, klistra in hela `schema.sql` och tryck **Run**. Det ska stå "Success".

### 2. Skapa ditt admin-konto
1. Gå till **Authentication → Users → Add user → Create new user**. Ange e-post och lösenord och kryssa i *Auto Confirm User*.
2. Gå till **Authentication → Sign In / Providers** och stäng av **Allow new users to sign up**, så att ingen annan kan skapa konto.

### 3. Koppla sajten till databasen
`config.js` är redan ifylld med projektets URL och publishable key. Den nyckeln är gjord för att ligga publikt, eftersom all säkerhet ligger i databasreglerna i `schema.sql`.

### 4. Publicera med GitHub Pages
1. Gå till repot och öppna **Settings → Pages**.
2. Välj **Build and deployment → Source: Deploy from a branch**, branch `main`, mapp `/ (root)`, och tryck **Save**.
3. Efter en minut eller två ligger sajten på:
   - Deltagare: `https://p12ftw.github.io/lillejul/`
   - Admin: `https://p12ftw.github.io/lillejul/admin.html`

Varje push till `main` publiceras automatiskt.

**Testa lokalt:** kör `python3 -m http.server 8000` i mappen och öppna `http://localhost:8000/admin.html`.

---

## Under quizkvällen
1. Öppna `admin.html` på datorn som är kopplad till TV:n och tryck **▶ Starta** på ditt quiz.
2. Deltagarna skannar QR-koden eller går till adressen och skriver PIN-koden.
3. Ett olämpligt namn tar du bort genom att klicka på det i lobbyn.
4. Tryck **Starta quiz**. Efter varje fråga visas rätt svar, sedan **Topplista** och sedan **Nästa fråga**.
5. Efter sista frågan visas pallen. Tryck **Stäng och radera omgången**.

Laddar någon om sidan eller låser mobilen hamnar de där de var.

## Bra att veta
- **Supabase gratisplan pausar projekt efter ca en veckas inaktivitet.** Logga in på supabase.com dagen innan och tryck *Restore* om projektet är pausat.
- Bilder förminskas automatiskt innan uppladdning, så mobilfoton går bra.
- Svarsalternativ C och D är valfria. Lämnar du dem tomma blir det en fråga med två alternativ, t.ex. ja/nej.
- Bara en omgång åt gången: startar du en ny försvinner den gamla.

## Felsökning
- **"Hittar inget quiz med den PIN-koden"**: värden har startat en ny omgång eller avslutat den gamla.
- **Bilduppladdning ger fel**: kontrollera att bucketen `quiz-images` finns under *Storage*. Fick SQL-körningen fel på de två sista `storage`-policyerna kan du skapa dem i *Storage → Policies*: INSERT och DELETE för `authenticated` på bucketen `quiz-images`.
- **Mobilerna byter inte fråga direkt**: realtid kräver att `schema.sql` kördes helt. Annars uppdaterar sidan sig ändå var 3:e sekund.

## Filer
```
index.html  player.js   – deltagare
admin.html  admin.js    – skapa quiz
host.html   host.js     – storskärm
lib.js, style.css       – delat
config.js               – dina Supabase-uppgifter
schema.sql              – databas, regler och spellogik
```
