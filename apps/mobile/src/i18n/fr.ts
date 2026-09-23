/**
 * Every string the player can see. The UI is French only (GRAPH_SPECIFICATION §1);
 * code and comments stay in English.
 *
 * Tone: plain verbs, sentence case, no apologies. The game is played aloud by
 * people who may not read easily, so strings are short and say what happens next.
 */

/** A book prompt as a question. French puts a non-breaking space before "?", so it never wraps alone. */
export const asQuestion = (text: string) => `${text}\u00A0?`;

export const fr = {
  app: {
    name: 'DSA',
    tagline: 'Découverte Sans Alphabet',
    offlineBadge: 'MODE HORS LIGNE (démo)',
    soon: 'Bientôt',
    loading: 'Un instant…',
    retry: 'Réessayer',
    close: 'Fermer',
    cancel: 'Annuler',
    back: 'Retour',
    home: 'Accueil',
    quit: 'Quitter la partie',
    quitConfirm: 'Quitter cette partie ?',
    quitConfirmBody: 'La partie sera abandonnée et le nom sera révélé.',
    quitConfirmYes: 'Quitter',
    sound: 'Son',
    soundOn: 'Le son est allumé',
    soundOff: 'Le son est coupé',
    theme: 'Thème',
    themeSystem: 'Automatique',
    themeLight: 'Clair',
    themeDark: 'Sombre',
  },

  home: {
    play: 'Jouer',
    playWithFriend: 'Jouer avec un ami',
    explore: 'Explorer',
    intro: 'Un joueur tire une carte. L’autre pose les questions du livre jusqu’à trouver le nom.',
    friendHint: 'Deux téléphones, un code de partie.',
    exploreHint: 'Parcourir le livre question par question.',
  },

  friend: {
    title: 'Jouer avec un ami',
    intro: 'Chacun sur son téléphone. L’un crée la partie, l’autre la rejoint avec le code.',
    create: 'Créer une partie',
    createHint: 'Tu choisis ton rôle et la façon de jouer. Tu reçois un code à partager.',
    join: 'Rejoindre une partie',
    joinHint: 'Ton ami t’a donné un code ou un QR code.',
    needsServer: 'Il faut le serveur pour jouer à deux téléphones. Le mode démo ne le permet pas.',
    roleTitle: 'Ton rôle',
    tireur: 'Je suis le Tireur',
    tireurHint: 'Tu tires la carte et tu réponds. Ton ami pose les questions.',
    decouvreur: 'Je suis le Découvreur',
    decouvreurHint: 'Tu poses les questions. Ton ami tire la carte et répond.',
    nameTitle: 'Ton prénom',
    nameHint: 'Ton ami le verra à ta place.',
    namePlaceholder: 'Par exemple : Awa',
    createRoom: 'Créer la partie',
    inputChosenByCreator: 'Celui qui crée la partie choisit pour les deux joueurs.',
  },

  join: {
    title: 'Rejoindre une partie',
    codeLabel: 'Code de la partie',
    codeHint: 'Les 4 chiffres que ton ami te montre.',
    codePlaceholder: 'DSA-1234',
    submit: 'Rejoindre',
    joining: 'On rejoint la partie…',
    scan: 'Scanner le QR code',
    scanTitle: 'Scanne le QR code',
    scanHint: 'Vise le QR code affiché sur le téléphone de ton ami.',
    scanNotARoom: 'Ce QR code n’est pas une partie DSA.',
    scanPermission: 'Pour scanner, l’application a besoin de la caméra.',
    scanAllow: 'Autoriser la caméra',
    scanDenied: 'La caméra est refusée. Tape le code à la place.',
    scanUnavailable: 'Pas de caméra ici. Tape le code, ou scanne le QR code avec l’appareil photo du téléphone.',
    incomplete: 'Le code a 4 chiffres, comme DSA-1234.',
  },

  lobby: {
    title: 'Partie créée',
    codeHint: 'Donne ce code à ton ami, ou fais-lui scanner le QR code.',
    share: 'Partager',
    shareMessage: (code: string, url: string) => `Rejoins ma partie de DSA ! Code : ${code}\n${url}`,
    copied: 'Lien copié. Colle-le dans un message.',
    qrLabel: (code: string) => `QR code de la partie ${code}`,
    seatsTitle: 'À la table',
    waitingFor: (role: string) => `En attente du ${role}…`,
    you: 'Toi',
    connected: 'Connecté',
    away: 'Absent un instant',
    disconnected: 'Déconnecté',
    unknown: 'Connexion…',
    inputMode: 'Façon de jouer',
    timer: 'Chronomètre',
    scope: 'La partie du livre',
    timerOn: 'Oui',
    timerOff: 'Non',
    cancel: 'Annuler la partie',
    leave: 'Quitter la partie',
    declined: (name: string | null) => `${name ?? 'Ton ami'} ne veut pas rejouer.`,
  },

  room: {
    tireurLooking: 'Le Tireur découvre sa carte…',
    tireurLookingHint: 'La première question arrive dès qu’il est prêt.',
    tireurThinking: 'Le Tireur réfléchit…',
    tireurThinkingHint: 'Il cherche le chemin du livre jusqu’à son nom.',
    tireurRedrew: 'Le Tireur a changé de nom.',
    readyHint: 'Touche la carte pour la retourner. Retiens bien le nom : c’est lui que ton ami doit trouver.',
    connectionLost: 'Connexion perdue… reconnexion',
    connectionLostHint: 'La partie reprend toute seule dès que le réseau revient.',
    otherAway: (name: string) => `${name} a quitté l’application un instant.`,
    otherGone: (name: string) => `${name} s’est déconnecté.`,
    otherGoneHint: 'Tu peux l’attendre ou abandonner la partie.',
    wait: 'Attendre',
    abandon: 'Abandonner',
    theOther: (role: string) => `Le ${role}`,
  },

  rematch: {
    // The room goes on after a game: same friend, same settings, a new name.
    next: 'Nom suivant',
    nextHint: 'Mêmes réglages, un nouveau nom.',
    swap: (role: string) => `Changer de rôle : tu deviens ${role}`,
    starting: 'On tire le nom suivant…',
    offer: (name: string | null) => `${name ?? 'Ton ami'} passe au nom suivant`,
    offerSame: (role: string) => `Tu restes ${role}.`,
    offerSwap: (role: string) => `Rôles inversés : tu deviens ${role}.`,
    join: 'Continuer',
    waitingTitle: (name: string | null) => `On attend ${name ?? 'ton ami'}…`,
    waitingHint: 'Mêmes réglages, un nouveau nom. La partie commence dès que ton ami continue.',
  },

  setup: {
    title: 'Nouvelle partie',
    roleTitle: 'Qui joue ?',
    inputTitle: 'Façon de jouer',
    voice: 'Voix',
    voiceHint: 'Parler et écouter, comme autour d’une table.',
    buttons: 'Boutons',
    buttonsHint: 'Toucher OUI, NON et les autres réponses.',
    start: 'Jouer',
    on: 'Activé',
    off: 'Désactivé',
    /** The creator of a room chooses these for both players. */
    forBoth: 'Tu choisis pour les deux joueurs.',
    selected: 'Choisi',
    timerTitle: 'Le temps',
    timer: 'Chronomètre',
    timerShort: (think: string, play: string) => `${think} + ${play}`,
    timerNone: 'Sans limite',
    /** Uses the real durations, so the players know what they are choosing. */
    timerHint: (think: string, play: string) => `${think} pour réfléchir, puis ${play} pour trouver.`,
    timerOff: 'Sans chronomètre : prenez le temps qu’il vous faut.',
    timerChosenByCreator: 'Celui qui crée la partie choisit pour les deux joueurs.',

    // "Practise a part of the book": it changes only which name is drawn.
    scopeSectionTitle: 'La partie du livre',
    scopeWhole: 'Tout le livre',
    scopeWholeHint: 'Le nom peut venir de n’importe quelle page.',
    scopeChoose: 'Choisir une partie',
    scopeChooseHint: 'S’entraîner sur une section : le nom vient de là.',
    scopeChangeChoice: 'Changer la partie choisie',
    scopeChosenByCreator: 'Celui qui crée la partie choisit pour les deux joueurs.',
    /** Always said, so nobody expects the questions to be shortened too. */
    scopeQuestionsUnchanged: 'Les questions commencent toujours au début du livre.',

    scopeTitle: 'Quelle partie du livre ?',
    scopeHint: 'Coche une ou plusieurs sections. Le nom à trouver viendra de là.',
    scopeLoading: 'On lit le sommaire du livre…',
    scopeEmpty: 'Aucune section à afficher.',
    scopeTickAll: 'Tout cocher',
    scopeConfirm: 'Utiliser cette partie',
    scopeWholeBook: 'Finalement, tout le livre',
    scopeNoneChosen: 'Rien de coché : ce sera tout le livre.',
    scopeNames: (n: number) => (n <= 1 ? `${n} nom` : `${n} noms`),
    scopeChosen: (sections: number, names: number, total: number) =>
      `${sections === 1 ? '1 section' : `${sections} sections`} · ${names <= 1 ? `${names} nom` : `${names} noms`} sur ${total}`,
    scopeExpand: (label: string) => `Ouvrir ${label}`,
    scopeCollapse: (label: string) => `Fermer ${label}`,
    /** The game screen and the lobby: « Partie : LES EVANGILES ». */
    scopeSummary: (labels: string[]) => `Partie : ${labels.join(', ')}`,
  },

  voice: {
    // Talking.
    holdToTalk: 'Maintenir pour parler',
    holdToTalkHint: 'Le plus sûr quand il y a du bruit.',
    freeTalk: 'Parler librement',
    freeTalkHint: 'Touche une fois, parle : ça s’arrête tout seul.',
    talkModeTitle: 'Comment parler',
    readyHold: 'Maintiens le bouton et parle',
    readyFree: 'Touche le bouton et parle',
    listening: 'Je t’écoute…',
    listeningFree: 'Je t’écoute… (touche pour arrêter)',
    analysing: 'J’analyse…',
    notYourTurn: 'Le micro s’allume à ton tour.',
    micLabel: 'Micro',
    heard: (text: string) => `J’ai entendu : « ${text} »`,
    notUnderstood: 'Je n’ai pas bien compris. Peux-tu répéter ?',
    tooShort: 'Garde le bouton appuyé pendant que tu parles.',
    notTheQuestion: (question: string) => `Je n’ai pas bien compris. La question est : ${question}`,
    decouvreurHint: 'Dis la question, un nom, ou « revenir à … ».',
    tireurHint: 'Dis OUI, NON, un long OUIIII… ou « question ».',
    guessHint: 'Dis OUI si c’est le nom, NON sinon.',
    // Borderline OUI / OUIOUIOUI (GRAPH_SPECIFICATION §1): one tap to be sure.
    confirmTitle: 'Tu as dit lequel ?',
    confirmHint: 'Je n’ai pas su faire la différence. Touche la bonne réponse.',
    // Fallbacks: the buttons always work.
    useButtons: 'Les boutons marchent toujours : la partie continue.',
    micDenied: 'Le micro est refusé. Joue avec les boutons, ou autorise le micro dans les réglages du téléphone.',
    micUnavailable: 'Pas de micro utilisable ici. Joue avec les boutons.',
    micFailed: 'Le micro n’a pas marché. Réessaie, ou joue avec les boutons.',
    serviceDown: 'La reconnaissance vocale ne répond pas. Réessaie, ou utilise les boutons.',
    // Calibration (GRAPH_SPECIFICATION §1).
    settingsTitle: 'Réglages de la voix',
    settingsLink: 'Réglages de la voix',
    settingsIntro: 'Ces réglages restent sur ce téléphone.',
    calibrationTitle: 'Régler ta voix',
    calibrationIntro:
      'Pour que l’application reconnaisse ton OUI et ton long OUIIII, dis-les chacun deux fois. Ça prend une minute.',
    calibrateStart: 'Commencer',
    calibrate: 'Régler ma voix',
    calibrateAgain: 'Refaire le réglage',
    calibrateForTireur: 'Calibrer pour ce Tireur',
    calibrateForTireurHint: 'Le Tireur dit OUI et OUIIII : l’application apprend sa voix.',
    offerTitle: 'Régler ta voix ?',
    offerHint: 'Une minute pour que l’application distingue ton OUI de ton long OUIIII.',
    offerLater: 'Plus tard',
    sayShort: 'Dis OUI normalement',
    sayLong: 'Dis OUIIII en le tenant longtemps',
    take: (n: number, total: number) => `Essai ${n} sur ${total}`,
    nothingHeard: 'Je n’ai rien entendu. Recommence, un peu plus fort.',
    resultTitle: 'Ta voix est réglée',
    resultWeak: 'Tes deux sons se ressemblent. Refais le réglage en tenant OUIIII plus longtemps.',
    shortMeasure: (seconds: string) => `Ton OUI dure ${seconds} s`,
    longMeasure: (seconds: string) => `Ton OUIIII dure ${seconds} s`,
    thresholdMeasure: (seconds: string) => `Au-delà de ${seconds} s, c’est OUI OUI OUI`,
    notCalibrated: 'Pas encore réglé : l’application utilise un réglage moyen.',
    liveTest: 'Dis l’un ou l’autre',
    liveTestHint: 'Pour vérifier : dis OUI ou OUIIII, je te dis ce que j’ai compris.',
    understood: (answer: string) => `J’ai compris : ${answer}`,
    understoodBorderline: 'Entre les deux : pendant la partie, je te demanderai de choisir.',
    done: 'Terminé',
    clear: 'Effacer le réglage',
    seconds: (ms: number) => (Math.round(ms / 100) / 10).toFixed(1).replace('.', ','),
  },

  choose: {
    title: 'Comment veux-tu jouer ?',
    decouvreur: 'Je suis le Découvreur',
    decouvreurHint: 'Tu poses les questions. L’application tire la carte et répond.',
    tireur: 'Je suis le Tireur',
    tireurHint: 'Tu reçois la carte et tu réponds. L’application pose les questions.',
    local: 'À deux sur ce téléphone',
    localHint: 'On se passe le téléphone à chaque tour.',
    starting: 'On prépare la partie…',
  },

  game: {
    ask: 'Poser la question',
    asking: 'Question posée',
    waitingAnswer: 'Le Tireur réfléchit…',
    answerIs: 'Réponse',
    proposeName: 'Proposer un nom',
    proposeNameTitle: 'Quel nom proposes-tu ?',
    proposeNamePlaceholder: 'Commence à écrire un nom',
    proposeNameEmpty: 'Aucun nom ne correspond.',
    proposeNameSend: 'Proposer ce nom',
    goBack: 'Revenir',
    goBackTitle: 'À quelle question veux-tu revenir ?',
    goBackHint: 'Cette question sera posée de nouveau.',
    /** The Tireur said "QUESTION": the pair goes back to the question that opened the list. */
    rewoundTo: (question: string) => `Le Tireur demande de revenir à « ${question} ».`,
    rewoundToStart: 'Le Tireur demande de tout reprendre depuis la première question.',
    trail: 'Le chemin parcouru',
    trailEmpty: 'Aucune question posée pour l’instant.',
    deadEnd: 'La liste est terminée et personne n’a dit oui.',
    deadEndHint: 'Reviens à une question précédente pour continuer.',
    characterReached: 'C’est le bon indice. Dis le nom maintenant.',
    guessPending: 'Tu proposes',
    guessWaiting: 'Le Tireur confirme…',
    guessRefused: 'Ce n’est pas le nom. La partie continue au même endroit.',
    yourTurnDecouvreur: 'À toi de poser la question.',
    yourTurnTireur: 'À toi de répondre.',
    aiThinking: 'L’application réfléchit…',
    aiAsked: 'L’application demande',
  },

  table: {
    yourTurn: 'À toi',
    tireurThinking: 'Le Tireur réfléchit…',
    decouvreurThinking: 'Le Découvreur réfléchit…',
    questionNumber: (n: number) => `Question ${n}`,
    questionsAsked: (n: number) => (n === 1 ? '1 question' : `${n} questions`),
    you: 'Toi',
    ai: 'IA',
    player: 'Joueur',
    turnOf: (role: string) => `Au tour du ${role}`,
  },

  conversation: {
    youAsked: 'Tu as demandé',
    youCalled: 'Tu as proposé',
    tireurSays: 'Le Tireur',
    earlier: 'Plus tôt',
    nextQuestion: 'Question suivante',
    firstQuestion: 'Première question',
    waiting: 'Le Tireur réfléchit…',
    deadEnd: 'Plus de question dans cette liste',
    deadEndHint: 'Personne n’a dit oui. Reviens à une question pour prendre un autre chemin.',
    characterReached: 'C’est le bon indice',
    characterReachedHint: 'Dis le nom maintenant.',
    seePath: 'Voir le chemin',
    pathTitle: 'Le chemin parcouru',
  },

  ready: {
    title: 'Regarde ta carte',
    hint: 'Touche la carte pour la retourner. Retiens le nom, puis cache-la.',
    done: 'C’est bon, je suis prêt',
    // §9: the thinking time, and drawing another name before the start.
    thinking: 'Réfléchis au chemin…',
    thinkingHint: 'Cherche dans le livre par où passer pour arriver à ce nom.',
    redraw: 'Changer de nom',
    redrawLeft: (n: number) => (n === 1 ? '1 restant' : `${n} restants`),
    redrawTitle: 'Tu ne trouves pas ce nom dans le livre ?',
    redrawBody: 'Tu recevras un autre nom. Celui-ci ne reviendra pas dans cette partie.',
    redrawConfirm: 'Oui, changer de nom',
    redrawCancel: 'Non, je garde ce nom',
    redrawNone: 'Tu as utilisé tous tes changements de nom.',
    redrawDone: 'Nouveau nom : regarde bien ta carte.',
  },

  /** The countdown, in the header and in the preparation views. */
  timer: {
    label: 'Temps restant',
    thinking: 'Temps pour réfléchir',
    playing: 'Temps pour trouver',
    /** Read aloud by screen readers, so it is words and not a clock face. */
    a11y: (seconds: number) =>
      seconds >= 60
        ? `Il reste ${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) > 1 ? 's' : ''} ${seconds % 60} secondes`
        : `Il reste ${seconds} seconde${seconds > 1 ? 's' : ''}`,
    warning: 'Plus que 30 secondes',
    lastCall: 'Plus que 10 secondes',
    up: 'Temps écoulé',
    /** "2 min", "40 s", "1 min 12 s" — the way the durations are written everywhere. */
    duration: (seconds: number) => {
      const whole = Math.max(0, Math.round(seconds));
      const minutes = Math.floor(whole / 60);
      const rest = whole % 60;
      if (minutes === 0) return `${rest} s`;
      if (rest === 0) return `${minutes} min`;
      return `${minutes} min ${rest} s`;
    },
    clock: (seconds: number) => {
      const whole = Math.max(0, Math.ceil(seconds));
      return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    },
  },

  tireur: {
    asks: 'Le Découvreur demande',
    calls: 'Le Découvreur propose',
    flipHint: 'Touche la carte pour la retourner',
    mistakeTitle: 'Tu t’es trompé ?',
    // The rule since 0010: "QUESTION" re-opens a list, it does not undo one answer.
    mistakeHint: 'Dis « QUESTION » pour revenir à la question qui a ouvert la liste. Deux ou trois fois pour remonter d’autant de listes.',
    rewindLabel: (n: number) => `QUESTION ×${n}`,
    rewindExplain: (n: number) =>
      n === 1
        ? 'Retour à la question qui a ouvert la liste en cours.'
        : `Retour ${n} listes plus haut.`,
    waitingAi: 'L’application choisit sa question…',
    card: 'Ta carte',
    reveal: 'Montrer',
    hide: 'Cacher',
    hidden: 'Carte cachée',
    hiddenHint: 'Touche « Montrer » quand personne ne regarde.',
    question: 'On te demande',
    noQuestion: 'Attends la prochaine question.',
    guessAsked: 'Le Découvreur propose',
    guessYes: 'C’est le nom',
    guessNo: 'Ce n’est pas le nom',
    rewind: 'QUESTION',
    rewindHint: 'Reviens à la question qui a ouvert la liste.',
    rewindOne: '×1',
    rewindTwo: '×2',
    rewindThree: '×3',
    rewindDone: 'On revient en arrière.',
  },

  answers: {
    OUI: 'OUI',
    NON: 'NON',
    OUI_REPETE: 'OUI OUI OUI',
    NON_REPETE: 'NON NON NON',
    JE_NE_SAIS_PAS: 'JE NE SAIS PAS',
    AUTRE: 'AUTRE',
  },

  /** What the phone says out loud. Written for a French voice, not for the eye. */
  spoken: {
    OUI: 'Oui.',
    NON: 'Non.',
    // The repeated codes are one held sound (GRAPH_SPECIFICATION §10), not three words.
    OUI_REPETE: 'Ouiiii !',
    NON_REPETE: 'Nonnnn !',
    JE_NE_SAIS_PAS: 'Je ne sais pas.',
    AUTRE: '',
    // The book label alone is the question (GAME_RULES "How questions are said"): "Ancien ?".
    question: (text: string) => asQuestion(text),
    guess: (name: string) => asQuestion(name),
    discovered: (name: string) => `C’est ${name} !`,
    deadEnd: 'La liste est terminée. Reviens à une question précédente.',
  },

  pass: {
    title: 'Passe le téléphone',
    toTireur: 'au Tireur',
    toDecouvreur: 'au Découvreur',
    ready: 'C’est moi',
    readyTireur: 'Je suis le Tireur',
    readyDecouvreur: 'Je suis le Découvreur',
    hintTireur: 'Tu vas voir la carte et répondre. Le Découvreur ne regarde pas.',
    hintDecouvreur: 'Tu vas poser la question. Ne regarde pas la carte.',
  },

  graph: {
    replay: 'Rejouer l’animation',
    fit: 'Tout voir',
    zoomIn: 'Agrandir',
    zoomOut: 'Réduire',
    hint: 'Pince ou fais glisser pour explorer.',
    empty: 'Aucune question n’a encore été posée.',
    a11y: (steps: number) => `Graphe du chemin parcouru, ${steps} ${steps === 1 ? 'question' : 'questions'}`,
  },

  result: {
    title: 'Trouvé !',
    abandoned: 'Partie arrêtée',
    timeUp: 'Temps écoulé',
    timeUpHint: 'Personne n’a trouvé à temps. Voici le nom, et le chemin du livre pour y arriver.',
    // §9: the end screen teaches the book's path, whatever the outcome.
    solutionIntro: (name: string) => `Le chemin du livre pour trouver ${name}`,
    solutionHint: 'Voici comment le livre mène à ce nom, question par question.',
    /** "Trouvé en 1 min 12 s sur 2 min" — only for a timed game that was won. */
    foundIn: (taken: string, limit: string) => `Trouvé en ${taken} sur ${limit}`,
    pathIntro: 'Voici le chemin que vous avez parcouru.',
    replay: 'Rejouer',
    home: 'Accueil',
    statQuestions: 'questions',
    statQuestion: 'question',
    statNon: 'non',
    statBacks: 'retours',
    statBack: 'retour',
    secretWas: 'Le nom était',
    noPath: 'Aucune question n’a été posée.',
    star: '⭐',
  },

  roles: {
    TIREUR: 'Tireur',
    DECOUVREUR: 'Découvreur',
    ai: 'IA',
    you: 'Toi',
  },

  errorTitle: 'Ça n’a pas marché',

  errors: {
    // Server codes (DATABASE_SCHEMA.md §3). Every DSA_<CODE> maps to one line.
    NOT_AUTHENTICATED: 'La connexion au serveur a été perdue. Réessaie.',
    NOT_PLAYER: 'Cette partie ne t’appartient pas.',
    WRONG_ROLE: 'Ce n’est pas à toi de faire ça.',
    WRONG_MODE: 'Cette action n’existe pas dans ce mode de jeu.',
    GAME_OVER: 'La partie est terminée.',
    NOT_AWAITING_QUESTION: 'Ce n’est pas le moment de poser une question.',
    NOT_AWAITING_ANSWER: 'Aucune question n’attend de réponse.',
    NOT_AWAITING_GUESS_CONFIRM: 'Aucun nom n’attend d’être confirmé.',
    NO_PROMPT: 'Il n’y a plus de question ici. Reviens en arrière.',
    ANSWER_NOT_ALLOWED: 'Cette réponse n’est pas permise pour cette question.',
    INVALID_NAME: 'Ce nom est vide ou trop long.',
    INVALID_STEP: 'Cette question n’existe plus. Commence une nouvelle partie.',
    INVALID_REWIND: '« QUESTION » se dit une, deux ou trois fois, et seulement après une première réponse.',
    INVALID_MODE: 'Ce mode de jeu n’existe pas.',
    INVALID_ROLE: 'Ce rôle n’existe pas.',
    GRAPH_NOT_FOUND: 'Le livre n’est pas encore publié sur le serveur.',
    GRAPH_INVALID: 'Le livre publié est incomplet.',
    NO_PLAYABLE_SECRET: 'Aucun nom n’est encore jouable dans ce livre.',
    ROOM_CODE_EXHAUSTED: 'Impossible de créer un code de partie. Réessaie.',
    ROOM_NOT_FOUND: 'Ce code ne correspond à aucune partie ouverte.',
    ROOM_FULL: 'Cette partie est déjà complète.',
    INVALID_SETTINGS: 'Ces réglages de partie ne sont pas valables.',
    TIREUR_NOT_READY: 'Le Tireur regarde encore sa carte. Attends un instant.',
    WAITING_FOR_PLAYER: 'L’autre joueur n’est pas encore arrivé.',
    GAME_NOT_OVER: 'Termine d’abord cette partie.',
    // Timed games and the name change (GRAPH_SPECIFICATION §9).
    TIME_UP: 'Le temps est écoulé.',
    GAME_STARTED: 'La partie a commencé : le nom ne peut plus changer.',
    NO_REDRAW_LEFT: 'Tu as déjà changé de nom le nombre de fois permis.',
    // Client-side codes.
    CONFIG_MISSING: 'L’application n’est pas configurée : il manque l’adresse du serveur.',
    PERMISSION_DENIED: 'Le serveur a refusé l’accès. Reconnecte-toi.',
    SESSION_NOT_FOUND: 'Cette partie n’existe plus.',
    NETWORK: 'Le serveur ne répond pas. Vérifie ta connexion.',
    UNKNOWN: 'Une erreur inattendue est survenue.',
  },
} as const;

export type ErrorCode = keyof typeof fr.errors;
