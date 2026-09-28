/** The web records Blobs (recorder.web.ts), never files; see audio-part.native.ts. */
export function audioFilePart(_uri: string, _name: string, _type: string): unknown {
  throw new Error('audioFilePart: no recorded files on the web');
}
