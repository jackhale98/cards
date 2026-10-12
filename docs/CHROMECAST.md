# Setting up Chromecast

Lamplight can cast the table straight to a Chromecast or Google TV: the host taps **Cast** and
the TV becomes the table display, no laptop or HDMI cable needed.

**Status: done.** Lamplight's receiver is published as App ID **`221DFB34`**, built into
`src/net/cast.ts`, so every build (including Cloudflare preview builds) can cast. This guide is how
it was set up, kept for reference: to change the receiver's settings, or to try a change on a
receiver of your own, set `VITE_CAST_APP_ID` to that receiver's ID for a build (step 4).

Time needed: about 20 minutes, plus up to 15 minutes waiting for Google to register a test device.

## 1. Register as a Cast developer

1. Go to the [Google Cast SDK Developer Console](https://cast.google.com/publish).
2. Sign in with a Google account. Your everyday account is fine; a separate one only matters if you
   want to hand the project to someone else later.
3. Accept the terms and pay the **one-time $5** registration fee.

## 2. Add Lamplight as an application

1. Click **Add new application**.
2. Choose **Custom Receiver**.
3. Fill in:
   - **Name:** `Lamplight`
   - **Receiver Application URL:** `https://lamplight.cards/?cast=1`
4. Save. The console shows an **Application ID**: eight letters and digits, e.g. `A1B2C3D4`.
   Copy it.

The App ID isn't secret. It ends up in the site's public JavaScript either way.

## 3. Register your Chromecast as a test device

A new application is *unpublished*, which means it only runs on Chromecasts you list as test
devices.

1. Find the Chromecast's **serial number**. It's printed on the device (or its power brick) and
   shown in the **Google Home** app: tap the device → ⚙ Settings → **Device information**.
2. In the Cast console, click **Add new device**, enter the serial number and a description.
3. Wait until its status says *Ready for testing* (can take up to 15 minutes), then **restart the
   Chromecast** (unplug it for a few seconds) so it picks up the change.

## 4. Give the App ID to the site

Lamplight's ID is built into `src/net/cast.ts`. To point a build at a different (test) receiver,
set it as a build variable instead:

1. Open the **Cloudflare dashboard** → **Workers & Pages** → the Lamplight Pages project.
2. **Settings** → **Variables and Secrets** (for *Production*) → **Add**:
   - **Name:** `VITE_CAST_APP_ID`
   - **Value:** the App ID from step 2
3. Save, then go to **Deployments** and **Retry deployment** on the latest one (or push any commit)
   so the site is rebuilt with it.

## 5. Try it

1. On an Android phone or a computer, open `lamplight.cards` in **Chrome** (casting only works in
   Chrome; on iPhone use the `/tv` code instead).
2. Make sure the phone and the Chromecast are on the **same Wi-Fi**.
3. Start a table, then tap **📺 TV** in the lobby (or **Show on a TV** from the table menu).
4. Tap **Cast** and pick your Chromecast. The TV loads Lamplight and opens the table display on
   its own.

## 6. Publish

Once it works on your test device, open the application in the Cast console and click
**Publish**. Publishing can take a few hours to reach every Chromecast; after that anyone's
Chromecast can show a Lamplight table, not just yours.

## Troubleshooting

| What you see | Try |
|---|---|
| No **Cast** button | Casting needs Chrome (Android or a computer), and a Chromecast on the same Wi-Fi for it to offer. |
| Chromecast isn't in the list | Phone and TV on the same Wi-Fi? Guest networks often block casting. |
| TV shows a blank or error screen | Unpublished app and the device isn't registered (or wasn't restarted after registering). Check its status in the console. |
| TV shows Lamplight but not the table | The table code didn't arrive: cast again from the table menu (**Show on a TV**). |
| Apple TV | Websites can't cast to Apple TV. Open `lamplight.cards/tv` on a TV with a browser, or Screen Mirror a spare iPad/phone that has the table open. |
