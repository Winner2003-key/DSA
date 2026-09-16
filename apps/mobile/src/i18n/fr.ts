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

  setup: {
    title: 'Préparer la partie',
    roleTitle: 'Qui joue ?',
    inputTitle: 'Façon de jouer',
    voice: 'Voix',
    voiceHint: 'Parler et écouter, comme autour d’une table.',
    buttons: 'Boutons',
    buttonsHint: 'Toucher OUI, NON et les autres réponses.',
    start: 'Commencer la partie',
    selected: 'Choisi',
  },

  choose: {
    title: 'Comment veux-tu jouer ?',
    decouvreur: 'Je suis le Découvreur',
    decouvreurHint: 'Tu poses les questions. L’application tire la carte et répond.',
    tireur: 'Je suis le Tireur',
    tireurHint: 'Tu reçois la carte et tu réponds. L’application pose les questions.',
    local: 'Deux joueurs sur ce téléphone',
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
    goBack: 'Revenir à une question',
    goBackTitle: 'À quelle question veux-tu revenir ?',
    goBackHint: 'Cette question sera posée de nouveau.',
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
  },

  tireur: {
    asks: 'Le Découvreur demande',
    calls: 'Le Découvreur propose',
    flipHint: 'Touche la carte pour la retourner',
    mistakeTitle: 'Tu t’es trompé ?',
    mistakeHint: 'Dis « QUESTION » une, deux ou trois fois pour revenir en arrière.',
    rewindLabel: (n: number) => `QUESTION ×${n}`,
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
    rewindHint: 'Reviens en arrière si tu t’es trompé.',
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
    abandoned: 'Partie abandonnée',
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
    INVALID_REWIND: 'On ne peut revenir que d’une, deux ou trois questions.',
    INVALID_MODE: 'Ce mode de jeu n’existe pas.',
    INVALID_ROLE: 'Ce rôle n’existe pas.',
    GRAPH_NOT_FOUND: 'Le livre n’est pas encore publié sur le serveur.',
    GRAPH_INVALID: 'Le livre publié est incomplet.',
    NO_PLAYABLE_SECRET: 'Aucun nom n’est encore jouable dans ce livre.',
    ROOM_CODE_EXHAUSTED: 'Impossible de créer un code de partie. Réessaie.',
    ROOM_NOT_FOUND: 'Ce code ne correspond à aucune partie ouverte.',
    ROOM_FULL: 'Cette partie est déjà complète.',
    INVALID_SETTINGS: 'Ces réglages de partie ne sont pas valables.',
    // Client-side codes.
    CONFIG_MISSING: 'L’application n’est pas configurée : il manque l’adresse du serveur.',
    PERMISSION_DENIED: 'Le serveur a refusé l’accès. Reconnecte-toi.',
    SESSION_NOT_FOUND: 'Cette partie n’existe plus.',
    NETWORK: 'Le serveur ne répond pas. Vérifie ta connexion.',
    UNKNOWN: 'Une erreur inattendue est survenue.',
  },
} as const;

export type ErrorCode = keyof typeof fr.errors;
