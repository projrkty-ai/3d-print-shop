import { t } from '../i18n';
import { Vector3 } from 'three';
import { MeshFileError } from './meshFileError';

type Triangle = [Vector3, Vector3, Vector3];

/** Slicer paint is a reversed hex stream describing a midpoint subdivision tree. */
export function paintedTriangle(
  triangle: Triangle,
  paint: string,
  emit: (vertices: Triangle, filament: number) => void,
) {
  if (!/^[0-9a-f]+$/i.test(paint)) throw new MeshFileError(t("The project contains invalid color painting."));
  let cursor = paint.length;
  const nibble = () => {
    if (cursor === 0) throw new MeshFileError(t("The project contains incomplete color painting."));
    return Number.parseInt(paint[--cursor], 16);
  };
  const midpoint = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);
  const visit = (vertices: Triangle, depth: number) => {
    if (depth > 32) throw new MeshFileError(t("The project color painting is nested too deeply."));
    const code = nibble();
    const splits = code & 3;
    if (splits === 0) {
      let state = code >> 2;
      if (state === 3) {
        state = nibble();
        state = state === 15 ? nibble() + 18 : state + 3;
      }
      emit(vertices, state);
      return;
    }
    const side = code >> 2;
    if (side > 2 || (splits === 3 && side !== 0)) {
      throw new MeshFileError(t("The project contains an invalid painted triangle split."));
    }
    const [a, b, c] = [vertices[side], vertices[(side + 1) % 3], vertices[(side + 2) % 3]];
    let children: Triangle[];
    if (splits === 1) {
      const bc = midpoint(b, c);
      children = [[a, b, bc], [bc, c, a]];
    } else if (splits === 2) {
      const ab = midpoint(a, b);
      const ac = midpoint(a, c);
      children = [[a, ab, ac], [ab, b, ac], [b, c, ac]];
    } else {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      children = [[a, ab, ca], [ab, b, bc], [bc, c, ca], [ab, bc, ca]];
    }
    for (let i = children.length - 1; i >= 0; i--) visit(children[i], depth + 1);
  };
  visit(triangle, 0);
  if (cursor !== 0) throw new MeshFileError(t("The project contains trailing color painting data."));
}
