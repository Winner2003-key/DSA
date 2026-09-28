/**
 * A recorded file as a multipart part for `expo/fetch`, which rejects React
 * Native's `{uri, name, type}` descriptors ("Unsupported FormDataPart
 * implementation") but accepts any object with `bytes()`, using `name` as the
 * filename and `type` as the part's Content-Type.
 */
import { File } from 'expo-file-system';

export function audioFilePart(uri: string, name: string, type: string): unknown {
  const file = new File(uri);
  return { name, type, bytes: () => file.bytes() };
}
