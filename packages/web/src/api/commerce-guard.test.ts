import { describe, expect, it } from 'bun:test';
import {
  MIN_MARGIN_ABS,
  coversCost,
  costFromPrintifyProduct,
  minRetailFor,
  resolveItemsAgainstCatalog,
  type GuardProduct,
} from './commerce-guard';

function product(p: Partial<GuardProduct> = {}): GuardProduct {
  return {
    id: 'p1',
    name: 'T-shirt Velbaz',
    status: 'active',
    retailPrice: 29.99,
    costPrice: 11.5,
    printifyProductId: null,
    variants: [],
    ...p,
  };
}

describe('minRetailFor', () => {
  it('renvoie 0 pour un coût inconnu ou absurde', () => {
    expect(minRetailFor(0)).toBe(0);
    expect(minRetailFor(-5)).toBe(0);
    expect(minRetailFor(Number.NaN)).toBe(0);
  });

  it('reste strictement au-dessus du coût, même pour un coût minuscule', () => {
    for (const cost of [0.01, 0.5, 1, 1.99, 2, 4.99, 11.5, 100, 999.5]) {
      const min = minRetailFor(cost);
      expect(min).toBeGreaterThan(cost);
      expect(min).toBeGreaterThanOrEqual(cost + MIN_MARGIN_ABS - 1);
    }
  });

  it('applique la marge de 40 % sur les prix élevés', () => {
    expect(minRetailFor(100)).toBe(140.99);
  });

  it('applique la marge absolue sur les petits prix', () => {
    expect(minRetailFor(1)).toBe(3.99);
  });

  it('termine toujours en .99', () => {
    for (const cost of [0.01, 3, 7.4, 62.3]) {
      expect(Math.round((minRetailFor(cost) % 1) * 100)).toBe(99);
    }
  });
});

describe('coversCost', () => {
  it('considère un coût inconnu comme non comparable', () => {
    expect(coversCost(10, null)).toBe(true);
    expect(coversCost(10, 0)).toBe(true);
    expect(coversCost(null, null)).toBe(true);
  });

  it('refuse un prix absent face à un coût connu', () => {
    expect(coversCost(null, 5)).toBe(false);
  });

  it('exige une marge strictement positive', () => {
    expect(coversCost(5, 5)).toBe(false);
    expect(coversCost(5.01, 5)).toBe(true);
    expect(coversCost(4.99, 5)).toBe(false);
  });
});

describe('resolveItemsAgainstCatalog — règle 1 (pas de produit, pas de paiement)', () => {
  it('refuse un panier vide', () => {
    const r = resolveItemsAgainstCatalog([product()], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_items');
  });

  it('accepte une ligne adossée à un vrai produit et impose le prix du catalogue', () => {
    const r = resolveItemsAgainstCatalog(
      [product()],
      [{ productId: 'p1', quantity: 2, name: 'Hacké', amount: 1 }],
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].unitAmountCents).toBe(2999); // pas les 1 centime envoyés par le navigateur
      expect(r.items[0].name).toBe('T-shirt Velbaz');
      expect(r.totalCents).toBe(5998);
    }
  });

  it('refuse un produit inexistant', () => {
    const r = resolveItemsAgainstCatalog([product()], [{ productId: 'fantome', quantity: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('product_not_found');
      expect(r.rejected[0].index).toBe(0);
    }
  });

  it('refuse une ligne sans référence produit en mode paiement', () => {
    const r = resolveItemsAgainstCatalog([product()], [{ name: 'Produit inventé', amount: 4900 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_product_reference');
  });

  it('refuse un produit encore à l’état de concept', () => {
    const r = resolveItemsAgainstCatalog([product({ status: 'concept' })], [{ productId: 'p1' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('product_not_published');
  });

  it('refuse un produit sans prix de vente', () => {
    const r = resolveItemsAgainstCatalog([product({ retailPrice: null })], [{ productId: 'p1' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('product_without_price');
  });

  it('refuse une variante inconnue', () => {
    const p = product({ variants: [{ vid: 'v1', label: 'M', price: 34.99 }] });
    const r = resolveItemsAgainstCatalog([p], [{ productId: 'p1', vid: 'v-nope' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('variant_not_found');
  });

  it('facture le prix de la variante demandée', () => {
    const p = product({ variants: [{ vid: 'v1', label: 'M', price: 34.99 }] });
    const r = resolveItemsAgainstCatalog([p], [{ productId: 'p1', vid: 'v1' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0].unitAmountCents).toBe(3499);
      expect(r.items[0].name).toBe('T-shirt Velbaz — M');
    }
  });

  it('bloque une ligne à perte (règle 2 en dernier rempart)', () => {
    const r = resolveItemsAgainstCatalog(
      [product({ retailPrice: 9, costPrice: 11.5 })],
      [{ productId: 'p1' }],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('price_below_supplier_cost');
      expect(r.rejected[0].minPriceCents).toBe(Math.round(minRetailFor(11.5) * 100));
    }
  });

  it('fait échouer tout le panier si une seule ligne est douteuse', () => {
    const r = resolveItemsAgainstCatalog(
      [product()],
      [{ productId: 'p1' }, { productId: 'fantome' }],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('cart_has_unknown_items');
      expect(r.rejected).toHaveLength(1);
    }
  });

  it('borne les quantités farfelues', () => {
    const r = resolveItemsAgainstCatalog([product()], [{ productId: 'p1', quantity: 100000 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0].quantity).toBe(100);
  });

  it('remet une quantité invalide à 1', () => {
    const r = resolveItemsAgainstCatalog([product()], [{ productId: 'p1', quantity: -3 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0].quantity).toBe(1);
  });

  it('autorise un abonnement sans productId', () => {
    const r = resolveItemsAgainstCatalog([], [{ name: 'Plan Pro', amount: 2900, interval: 'month' }], {
      mode: 'subscription',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0].productId).toBeNull();
      expect(r.items[0].unitAmountCents).toBe(2900);
      expect(r.items[0].interval).toBe('month');
    }
  });

  it('refuse un abonnement sans montant', () => {
    const r = resolveItemsAgainstCatalog([], [{ name: 'Plan Pro', amount: 0 }], { mode: 'subscription' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('plan_without_price');
  });
});

describe('costFromPrintifyProduct — coût de production réel', () => {
  it('prend le coût le plus élevé parmi les variantes actives', () => {
    const info = costFromPrintifyProduct({
      variants: [
        { id: 1, price: 2000, cost: 900, is_enabled: true },
        { id: 2, price: 2000, cost: 1250, is_enabled: true },
        { id: 3, price: 2000, cost: 4000, is_enabled: false },
      ],
    });
    expect(info.costPrice).toBe(12.5);
    expect(info.source).toBe('printify_api');
    expect(info.variants).toHaveLength(3);
  });

  it('retombe sur les variantes désactivées si aucune active n’a de coût', () => {
    const info = costFromPrintifyProduct({
      variants: [{ id: 1, price: 2000, cost: 1500, is_enabled: false }],
    });
    expect(info.costPrice).toBe(15);
  });

  it('n’invente aucun coût quand la réponse est vide ou inutilisable', () => {
    expect(costFromPrintifyProduct(null).costPrice).toBeNull();
    expect(costFromPrintifyProduct({ variants: [] }).costPrice).toBeNull();
    expect(costFromPrintifyProduct({ variants: [{ id: 1, price: 2000, cost: 0 }] }).costPrice).toBeNull();
    expect(costFromPrintifyProduct({ variants: 'nope' }).source).toBe('unknown');
  });

  it('un prix corrigé depuis le coût Printify est toujours rentable', () => {
    const info = costFromPrintifyProduct({ variants: [{ id: 1, price: 500, cost: 1250, is_enabled: true }] });
    const min = minRetailFor(info.costPrice as number);
    expect(min).toBeGreaterThan(info.costPrice as number);
    expect(coversCost(min, info.costPrice)).toBe(true);
    expect(coversCost(5, info.costPrice)).toBe(false); // prix Printify d'origine : à perte
  });
});
