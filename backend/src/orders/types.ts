import type { Order, OrderItem, OrderPrice, OrderProject, OrderSource } from '../domain/types';

/** What a model source contributes to a new order; everything else is the same for every order. */
export interface SourceDraft {
  source: OrderSource;
  items: OrderItem[];
  price: OrderPrice;
  project?: OrderProject;
  /** Runs once the order is stored, e.g. to claim uploaded files; throwing removes the order again. */
  afterInsert?: (order: Order) => Promise<void>;
}
