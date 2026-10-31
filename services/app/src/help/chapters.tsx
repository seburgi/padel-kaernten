// The chapters of the Hilfe, in reading order. Each says what a part of the
// app is for and how it is used, in the words the screens use, so a change
// to a screen's words changes them here too (docs/design/help.md).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { link } from "../ui";
import type SHOTS from "./shots.json";

/** A picture from tools/help-shots.mjs: its name in shots.json, and what it shows. */
export type Shot = { name: keyof typeof SHOTS; alt: string };

export type Chapter = {
  /** The anchor, German like the words on screen: /help#gruppen. */
  id: string;
  title: string;
  lead: string;
  body: ReactNode;
  shots?: Shot[];
};

const b = (text: string) => <b className="font-semibold">{text}</b>;

export const CHAPTERS: Chapter[] = [
  {
    id: "start",
    title: "Willkommen",
    lead: "Padel Kärnten zeigt, wo in Kärnten ein Padelplatz frei ist, und hilft dir, mit deinen Leuten ein Spiel zu viert auszumachen.",
    body: (
      <>
        <p>
          Die App ist privat: Hinein kommt nur, wer eingeladen wurde. Sie kostet nichts, zeigt keine
          Werbung und bucht selbst nichts. Gebucht und bezahlt wird auf der Seite der Anlage.
        </p>
        <p>
          Bist du in einer Gruppe, öffnet die App mit Spielen, sonst mit Plätze. Am Handy wechselst
          du unten zwischen den Bereichen, auf einem größeren Bildschirm oben. {b("Plätze")} zeigt,
          was frei ist, unter {b("Wann kann ich?")} sagst du, wann du kannst, und {b("Spielen")}{" "}
          zeigt, was ansteht (wer neu ist, sieht dort zuerst {b("Dein erstes Spiel")}
          mit den drei Schritten): was auf deine Antwort wartet, deine Spiele, wann es für vier
          passt, und deine Gruppen.
        </p>
      </>
    ),
  },
  {
    id: "plaetze",
    title: "Freie Plätze",
    lead: "Unter Plätze siehst du alle Anlagen auf einen Blick, mit allem, was zu deiner Zeit frei ist.",
    body: (
      <>
        <p>
          Wähl oben den Tag, dann {b("Beginn ab")} und {b("Ende bis")}, wie lange ihr spielt (1 h,
          1,5 h oder 2 h) und ob Halle oder Freiluft. Die Liste zeigt jede Anlage, die in diesem
          Fenster einen Platz für die ganze Zeit frei hat, mit den möglichen Startzeiten und, wo die
          Anlage ihn nennt, dem Preis. Hast du unter {b("Mehr")} › {b("Deine Plätze")} Anlagen
          gewählt, siehst du nur diese.
        </p>
        <p>
          {b("Zur Buchung")} öffnet die Buchungsseite der Anlage, eine Startzeit auch, solange du in
          keiner Gruppe bist. Bist du in einer, zeigt ein Tipp auf die Startzeit, wer aus deinen
          Gruppen dann kann, und mit {b("In … vorschlagen")} wird daraus ein Spiel;{" "}
          {b("Selbst buchen")} führt weiter zur Anlage. Ist nichts frei, kannst du das Fenster
          erweitern, kürzer spielen oder den nächsten Tag ansehen.
        </p>
        <p>
          Die App fragt die Anlagen alle 30 Minuten von selbst ab; wie alt die Zeiten sind, steht
          unter der Suche bei {b("Stand")}. Mit {b("Aktualisieren")} fragt sie sofort neu, für alle,
          höchstens alle fünf Minuten: Ist der Stand jünger, steht dort, ab wann es wieder geht. Ist
          eine Anlage gerade nicht erreichbar, steht das unten, und alle anderen siehst du trotzdem.
          Manche Anlagen lassen nur wenige Tage im Voraus buchen; sie stehen dann unter{" "}
          {b("Noch nicht buchbar")}.
        </p>
        <p>Wer einen Platz gebucht hat, zeigt die App nie. Sie weiß nur, was frei ist.</p>
      </>
    ),
    shots: [
      {
        name: "plaetze",
        alt: "Plätze: oben Tag, Beginn ab, Ende bis, Spieldauer und Halle oder Freiluft, darunter eine Anlage mit ihren freien Startzeiten und Preisen.",
      },
    ],
  },
  {
    id: "zeiten",
    title: "Wann kannst du?",
    lead: "Du sagst einmal, wann du in den nächsten zwei Wochen spielen kannst. Alle deine Gruppen sehen es.",
    body: (
      <>
        <p>
          {b("Wann kann ich?")}, am Handy unten, sonst oben, führt zu den nächsten 14 Tagen, jeder
          als Zeile von 6 bis 24 Uhr. Tipp auf einen Tag und wähl, von wann bis wann du kannst, in
          halben Stunden. Schneller geht es mit {b("Früh 7–9")}, {b("Mittag 12–14")},{" "}
          {b("Abend ab 18")} oder {b("Ganzer Tag")}. Mit {b("+ Noch eine Zeit")} trägst du mehrere
          Zeiten an einem Tag ein.
        </p>
        <p>
          Passt ein Tag gar nicht, tipp auf {b("Passt nicht")}. Die Zeile ist dann schraffiert, und
          oben siehst du, wie viele Tage noch offen sind. So weißt du, welche Tage du schon bedacht
          hast. {b("Wieder offen")} nimmt den Eintrag zurück.
        </p>
        <p>
          Ein offener Tag zählt für Spiele wie „kann nicht“. Fehlt in einer Gruppe nur noch eine
          Person, nennt die App aber, wer den Tag noch offen hat, damit ihr fragen könnt. Wer „Passt
          nicht“ gesagt hat, wird für diesen Tag nicht gefragt.
        </p>
        <p>
          Mit {b("So ist es meistens am …")} merkt sich die App einen Tag als üblich für seinen
          Wochentag. Leere Tage füllt sie damit nur, wenn du {b("wie meistens füllen")} antippst,
          nie von selbst.
        </p>
        <p>
          Unter {b("Mehr")} › {b("Deine Plätze")} wählst du die Anlagen, zu denen du fährst; unter
          den Tagen steht, welche es sind, mit {b("Ändern")} kommst du hin. Wählst du keine, gilt
          jede.
        </p>
      </>
    ),
    shots: [
      {
        name: "zeiten",
        alt: "Wann kannst du?: oben, wie viele Tage noch offen sind, darunter die nächsten Tage als Zeilen von 6 bis 24 Uhr, die eingetragenen Zeiten grün, ein Tag schraffiert mit „Passt nicht“.",
      },
      {
        name: "zeiten-tag",
        alt: "Ein Tag offen: Schnellwahl Früh, Mittag, Abend, Ganzer Tag, zwei Zeiten mit von und bis, „+ Noch eine Zeit“, „So ist es meistens am …“, Speichern, Passt nicht und Wieder offen.",
      },
    ],
  },
  {
    id: "gruppen",
    title: "Gruppen",
    lead: "Gespielt wird in Gruppen. Jede und jeder kann eine gründen, und alle in einer Gruppe können Leute einladen.",
    body: (
      <>
        <p>Es gibt drei Arten von Gruppen:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{b("Privat")}: Nur wer eingeladen ist, sieht die Gruppe.</li>
          <li>
            {b("Auf Anfrage")}: Alle in der App sehen sie und können anfragen; jemand aus der Gruppe
            lässt sie herein.
          </li>
          <li>{b("Offen")}: Alle sehen sie und können gleich beitreten.</li>
        </ul>
        <p>
          {b("Gruppen finden")} unter Spielen zeigt, wo du beitreten oder anfragen kannst.{" "}
          {b("Neue Gruppe")} gründet eine; du bist dann ihr Admin und kannst Namen und Art ändern.
        </p>
        <p>
          Alles, was die Gruppe selbst betrifft, steht auf ihrer Seite unter {b("Verwalten")}: wo
          ihr spielt, die Mitglieder, wer hinein möchte, Einladen, Name und Art (für Admins) und
          Verlassen. Dort lädst du jemanden mit der E-Mail-Adresse ein. Wer noch nicht in der App
          ist, kommt damit auch hinein und meldet sich auf padel.burgstaller.me an; wer neu ist,
          bekommt eine Mail, um ein Passwort zu setzen. Einladungen findest du unter Spielen und
          nimmst sie dort an oder lehnst sie ab. Du kannst bis zu 20 offene Einladungen haben und 10
          neue am Tag verschicken.
        </p>
        <p>
          Bei den Mitgliedern steht, an wie vielen der nächsten 14 Tage sie ihre Zeiten eingetragen
          haben. Unten unter Verwalten steht {b("Gruppe verlassen …")}; geht der letzte Admin, wird
          wer am längsten dabei ist Admin.
        </p>
      </>
    ),
    shots: [
      {
        name: "gruppen-finden",
        alt: "Gruppen finden: eine Gruppe auf Anfrage mit „Anfragen“ und eine offene mit „Beitreten“.",
      },
      {
        name: "gruppe",
        alt: "Gruppe verwalten: Wo spielt ihr? mit Beides, Halle und Freiluft, die Mitglieder mit den Tagen, an denen sie Zeiten eingetragen haben, darunter Einladen mit der E-Mail-Adresse.",
      },
    ],
  },
  {
    id: "spiele",
    title: "Spiele zu viert",
    lead: "Die App legt eure Zeiten über die freien Plätze und zeigt, wann vier von euch können und ein Platz frei ist.",
    body: (
      <>
        <p>
          Auf der Seite einer Gruppe stehen unter {b("Passt für vier")} die nächsten passenden
          Zeiten. {b("Alle Zeiten")} öffnet {b("Wann passt es für vier?")} mit allen, nach Tagen,
          für 60, 90 oder 120 Minuten, mit Preis pro Kopf. Unter {b("Fast: eine Person fehlt")}{" "}
          stehen Zeiten, zu denen drei können und jemand den Tag noch nicht eingetragen hat. Die
          Person könnt ihr fragen, oder du schlägst die Zeit gleich vor, und ein Platz bleibt frei,
          bis jemand zusagt.
        </p>
        <p>
          Darunter zeigt {b("Wer kann wann")} die nächsten 14 Tage der ganzen Gruppe, jede halbe
          Stunde von 6 bis 24 Uhr. Je dunkler ein Feld, desto mehr von euch können; ab vier hat es
          einen Punkt. Am Computer stehen die Namen da, wenn du mit der Maus darüberfährst. Ein Tipp
          auf einen Tag zeigt seine Zeiten mit Namen, wer „Passt nicht“ gesagt hat und wer den Tag
          noch offen hat. Ob ein Platz frei ist, steht dort nicht, das sagt {b("Passt für vier")}.
        </p>
        <p>
          Wo ihr spielt, wählt ihr unter {b("Verwalten")}: {b("Halle")}, {b("Freiluft")} oder{" "}
          {b("Beides")}. Das gilt für die ganze Gruppe, und jedes Mitglied kann es ändern.
          Überdachte Plätze zählen zur Halle. Steht nicht Beides, sieht man es auch auf der Seite
          der Gruppe.
        </p>
        <p>
          {b("Vorschlagen")} macht aus einer Zeit ein Spiel, und du bist dabei. Die anderen sagen{" "}
          {b("Bin dabei")} oder {b("Kann nicht")}. Wer nach vier noch zusagt, ist Ersatz und rückt
          nach, wenn jemand absagt.
        </p>
        <p>
          Auf der Seite eines Spiels zeigen vier Kreise, wer schon dabei ist, und{" "}
          {b("So geht es weiter")} die drei Schritte bis zum gebuchten Platz.
        </p>
        <p>
          Wer vorgeschlagen hat, bucht: {b("Zur Buchung")} öffnet die Seite der Anlage, danach sagt{" "}
          {b("Gebucht")} allen Bescheid. {b("Spiel absagen")} kann auch nur, wer vorgeschlagen hat.
        </p>
        <p>
          Unter Spielen steht ganz oben {b("Wartet auf dich")}: Spiele, auf die du noch nicht
          geantwortet hast, mit {b("Bin dabei")} und {b("Kann nicht")} gleich auf der Karte, und
          Einladungen in Gruppen. Darunter {b("Deine nächsten Spiele")}, bei denen du dabei oder
          Ersatz bist, und {b("Passt für vier")}: die nächsten passenden Zeiten aus all deinen
          Gruppen, zum Vorschlagen mit einem Tipp. Gibt es mehr als drei, öffnet {b("Alle Zeiten")}{" "}
          sie alle, nach Tagen. Alle Spiele einer Gruppe stehen auf ihrer Seite.
        </p>
      </>
    ),
    shots: [
      {
        name: "spiele-passt",
        alt: "Wann passt es für vier?: Dauer 60, 90 oder 120 Minuten, wo die Gruppe spielt, darunter passende Zeiten mit Anlage, Preis pro Kopf, wer kann, und Vorschlagen.",
      },
      {
        name: "wer-kann",
        alt: "Wer kann wann: die nächsten 14 Tage nebeneinander, die Uhrzeit nach unten, abends dunkle Felder mit Punkt, wo vier können.",
      },
      {
        name: "spiele-fast",
        alt: "Fast: eine Person fehlt: drei können, die App sagt, wen ihr fragen könnt, und Vorschlagen.",
      },
      {
        name: "spiel",
        alt: "Ein vorgeschlagenes Spiel: drei Kreise besetzt, einer frei, darunter So geht es weiter mit Vorgeschlagen, Vier sagen zu und Du buchst, und für wer vorgeschlagen hat Zur Buchung, Gebucht und Spiel absagen.",
      },
      {
        name: "spielen",
        alt: "Spielen: Wartet auf dich mit einem Spiel und Bin dabei, deine nächsten Spiele, Passt für vier und deine Gruppen.",
      },
    ],
  },
  {
    id: "mitteilungen",
    title: "Mitteilungen",
    lead: "Die App kann dir Bescheid sagen, wenn sich bei einem Spiel etwas tut.",
    body: (
      <>
        <p>
          Du hörst davon, wenn jemand in deiner Gruppe ein Spiel vorschlägt, wenn ihr vier seid,
          wenn du als Ersatz nachrückst, wenn gebucht ist und wenn ein Spiel abgesagt wird. Was du
          selbst tust, meldet sie dir nicht. Ein Tipp auf die Mitteilung öffnet das Spiel.
        </p>
        <p>
          Einschalten kannst du sie unter Spielen mit {b("Mitteilungen einschalten")}; dein Browser
          fragt dann um Erlaubnis. Das gilt für dieses Gerät, auf jedem weiteren schaltest du sie
          eigens ein. Sind sie an, steht das am Handy unter {b("Mehr")}, auf einem größeren
          Bildschirm unter Spielen; dort schaltest du sie auch wieder aus.
        </p>
        <p>
          Auf dem iPhone gehen Mitteilungen nur, wenn Padel Kärnten auf dem Home-Bildschirm liegt
          (nächstes Kapitel). Hast du sie im Browser einmal blockiert, erlaubst du sie in seinen
          Einstellungen wieder.
        </p>
      </>
    ),
  },
  {
    id: "handy",
    title: "Am Handy",
    lead: "Auf dem Home-Bildschirm öffnet sich Padel Kärnten wie eine eigene App.",
    body: (
      <>
        <p>
          {b("iPhone")}: in Safari {b("Teilen")} antippen, dann {b("Zum Home-Bildschirm")}.
        </p>
        <p>
          {b("Android")}: in Chrome das Menü ⋮ öffnen, dann {b("App installieren")} oder{" "}
          {b("Zum Startbildschirm hinzufügen")}.
        </p>
        <p>
          Gibt es eine neue Version, sagt die App es unten mit {b("Eine neue Version ist da.")}; ein
          Tipp lädt sie.
        </p>
      </>
    ),
  },
  {
    id: "feedback",
    title: "Neuigkeiten und Feedback",
    lead: "Was sich ändert, steht unter Neuigkeiten. Was dir fehlt oder stört, sagst du mit der Sprechblase.",
    body: (
      <>
        <p>
          {b("Neuigkeiten")} (am Handy unter {b("Mehr")}, sonst oben rechts) listet, was sich in der
          App geändert hat. Gibt es etwas, das du noch nicht gesehen hast, steht auf Plätze und
          Spielen eine kleine Karte unter dem Kopf, und am Handy trägt {b("Mehr")} einen Punkt.
        </p>
        <p>
          Die {b("Sprechblase")} oben rechts öffnet ein Feld für deine Rückmeldung an Seb, zu genau
          dem Bildschirm, auf dem du gerade bist. Du kannst darauf markieren, was du meinst. Deine
          bisherigen Rückmeldungen und die Antworten darauf findest du unter{" "}
          <Link to="/feedback" className={link}>
            Dein Feedback
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "privat",
    title: "Wer sieht was?",
    lead: "Die App zeigt nur so viel, wie zum gemeinsamen Spielen nötig ist.",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Deine Zeiten und Anlagen sehen alle in den Gruppen, in denen du bist.</li>
        <li>
          Wer eine Gruppe sieht, sieht ihre Mitglieder mit Namen; wer noch keinen Namen angegeben
          hat, erscheint mit der E-Mail-Adresse. Deinen Namen änderst du unter {b("Mehr")} ›{" "}
          {b("Dein Name")}.
        </li>
        <li>Eine private Gruppe sieht niemand von außen, nicht einmal, dass es sie gibt.</li>
        <li>Ein Spiel sehen nur die Mitglieder seiner Gruppe.</li>
        <li>Wer einen Platz bei einer Anlage gebucht hat, zeigt die App nie.</li>
      </ul>
    ),
  },
  {
    id: "fragen",
    title: "Häufige Fragen",
    lead: "Kurze Antworten auf das, was oft gefragt wird.",
    body: (
      <dl className="space-y-3">
        <div>
          <dt className="font-semibold">Kostet das etwas?</dt>
          <dd>Nein. Bezahlt wird nur der Platz, bei der Anlage.</dd>
        </div>
        <div>
          <dt className="font-semibold">Bucht die App für mich?</dt>
          <dd>
            Nein. Sie führt zur Buchungsseite der Anlage; wer ein Spiel vorgeschlagen hat, bucht
            dort und tippt danach {b("Gebucht")}.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Warum fehlt eine Anlage?</dt>
          <dd>
            Entweder ist dort zu deiner Zeit nichts frei, die Anlage lässt so weit im Voraus noch
            nicht buchen, oder ihre Seite war gerade nicht erreichbar. Alle drei Fälle stehen unter
            der Liste.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Wie lade ich jemanden ein?</dt>
          <dd>
            Auf der Seite deiner Gruppe, mit der E-Mail-Adresse. Damit kommt die Person auch in die
            App.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Wie komme ich wieder hinaus?</dt>
          <dd>
            Aus einer Gruppe gehst du unter Verwalten auf ihrer Seite. Willst du die App ganz
            verlassen, sag es Seb mit der Sprechblase.
          </dd>
        </div>
      </dl>
    ),
  },
];
