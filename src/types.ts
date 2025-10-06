export type BinRange = {
  label: string;
  min: number;
  max: number;
};

export type SegmentDistribution = {
  major: string;
  grade: number;
  label: string;
  counts: number[];
  total: number;
};

export type DistributionDataset = {
  bins: BinRange[];
  segments: SegmentDistribution[];
};
