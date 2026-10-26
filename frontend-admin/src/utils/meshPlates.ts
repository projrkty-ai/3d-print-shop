import type { MeshFile, MeshPlate, Product } from '../types';

export function selectedPlateIds(mesh: MeshFile): number[] {
  return mesh.selectedPlates ?? (mesh.plate === null ? [] : [mesh.plate]);
}

export function includedProductPlates(product: Product): MeshPlate[] {
  if (!product.mesh) return [];
  const ids = selectedPlateIds(product.mesh);
  return product.mesh.plates.filter((plate) => ids.includes(plate.id));
}

export function plateParts(product: Product, plate: MeshPlate) {
  return (plate.parts ?? product.mesh?.parts ?? []).map((part) => ({
    ...part, name: product.mesh?.parts.find((shared) => shared.key === part.key)?.name ?? part.name,
  }));
}
