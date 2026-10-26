/** Problems with a model file that the user should see; other errors are unexpected. */
export class MeshFileError extends Error {
  override name = 'MeshFileError';
}
