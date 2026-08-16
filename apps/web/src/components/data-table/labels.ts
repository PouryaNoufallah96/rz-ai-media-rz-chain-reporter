export interface DataTableLabels {
  readonly caption: string;
  readonly empty: string;
  readonly loading: string;
  readonly nextPage: string;
  readonly pageRange: (range: {
    from: number;
    to: number;
    total: number;
  }) => string;
  readonly previousPage: string;
  readonly search: string;
  readonly searchPlaceholder: string;
  readonly sortAscending: string;
  readonly sortDescending: string;
  readonly updating: string;
}
