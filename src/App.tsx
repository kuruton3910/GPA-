import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartData, ChartOptions, TooltipItem } from "chart.js";
import { Bar } from "react-chartjs-2";
import currentTermCsv from "./data/sample-students.csv?raw";
import cumulativeCsv from "./data/cumulative-students.csv?raw";
import type {
  BinRange,
  DistributionDataset,
  SegmentDistribution,
} from "./types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const EMPTY_DATASET: DistributionDataset = { bins: [], segments: [] };

const numberFormatter = (fraction = 1) =>
  new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  });

const formatDecimal = (value: number | null, fraction = 1) =>
  value === null ? "-" : numberFormatter(fraction).format(value);

const formatCount = (value: number) => value.toLocaleString("ja-JP");

const sumCounts = (counts: number[]) =>
  counts.reduce((sum, value) => sum + value, 0);

const weightedAverage = (counts: number[], bins: BinRange[]): number | null => {
  const total = sumCounts(counts);
  if (total === 0) {
    return null;
  }

  const totalScore = counts.reduce((acc, count, index) => {
    const bin = bins[index];
    if (!bin) {
      return acc;
    }
    const midpoint = (bin.min + bin.max) / 2;
    return acc + count * midpoint;
  }, 0);

  return totalScore / total;
};

const aggregateSegments = (
  segments: SegmentDistribution[],
  binLength: number
) => {
  const counts = Array.from({ length: binLength }, () => 0);
  let total = 0;

  segments.forEach((segment) => {
    segment.counts.forEach((value, index) => {
      counts[index] = (counts[index] ?? 0) + value;
    });
    total += segment.total;
  });

  return { counts, total };
};

const parseRange = (label: string): BinRange => {
  const match = label.match(
    /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\s*[^\d]*)?$/
  );
  if (!match) {
    throw new Error(`範囲ラベルの形式が不正です: ${label}`);
  }
  return {
    label,
    min: Number.parseFloat(match[1]),
    max: Number.parseFloat(match[2]),
  };
};

const parseDistributionCsv = (raw: string): DistributionDataset => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return { bins: [], segments: [] };
  }

  const headerCells = lines[0].split(",");
  const binLabels = headerCells
    .slice(1)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  const bins = binLabels.map(parseRange);

  const segments: SegmentDistribution[] = lines.slice(1).flatMap((line) => {
    const cells = line.split(",");
    if (cells.length <= 1) {
      return [];
    }

    const rawLabel = cells[0]?.trim();
    if (!rawLabel) {
      return [];
    }

    const gradeMatch = rawLabel.match(/(\d+)\s*回生$/);
    const grade = gradeMatch ? Number.parseInt(gradeMatch[1], 10) : 0;
    const major = gradeMatch
      ? rawLabel.replace(/\s*\d+\s*回生$/, "").trim()
      : rawLabel;

    const counts = bins.map((_, index) => {
      const cell = cells[index + 1]?.trim() ?? "";
      const value = cell === "" ? 0 : Number.parseInt(cell, 10);
      return Number.isNaN(value) ? 0 : value;
    });

    const total = sumCounts(counts);

    return [
      {
        major,
        grade,
        label: rawLabel,
        counts,
        total,
      },
    ];
  });

  segments.sort((a, b) => {
    if (a.major === b.major) {
      return a.grade - b.grade;
    }
    return a.major.localeCompare(b.major, "ja");
  });

  return { bins, segments };
};

const findSegment = (
  segments: SegmentDistribution[],
  major: string,
  grade: number
) =>
  segments.find(
    (segment) => segment.major === major && segment.grade === grade
  ) ?? null;

const computeRankInfo = (
  segment: SegmentDistribution | null,
  bins: BinRange[],
  rawGpa: number
) => {
  if (!segment || segment.total === 0 || bins.length === 0) {
    return { rank: null, percentile: null };
  }

  const minBound = bins[0].min;
  const maxBound = bins[bins.length - 1].max;
  const sanitizedGpa = Number.isNaN(rawGpa) ? minBound : rawGpa;
  const gpa = Math.min(Math.max(sanitizedGpa, minBound), maxBound);

  let binIndex = bins.findIndex((bin, index) => {
    const upper = index === bins.length - 1 ? bin.max : bin.max + 0.0001;
    return gpa >= bin.min && gpa <= upper;
  });

  if (binIndex === -1) {
    binIndex = bins.length - 1;
  }

  let higherCount = 0;
  for (let index = bins.length - 1; index > binIndex; index -= 1) {
    higherCount += segment.counts[index] ?? 0;
  }

  const targetBin = bins[binIndex];
  const binCount = segment.counts[binIndex] ?? 0;
  const rangeWidth = targetBin.max - targetBin.min;
  const effectiveWidth = rangeWidth <= 0 ? 1 : rangeWidth;
  const fractionAbove =
    binCount === 0
      ? 0
      : Math.max(0, Math.min(1, (targetBin.max - gpa) / effectiveWidth));

  higherCount += binCount * fractionAbove;

  const rank = higherCount + 1;
  const percentile = (rank / segment.total) * 100;

  return { rank, percentile };
};

const App = () => {
  const currentDataset = useMemo(
    () => parseDistributionCsv(currentTermCsv),
    []
  );
  const cumulativeDataset = useMemo(
    () => parseDistributionCsv(cumulativeCsv),
    []
  );

  const datasetOptions = useMemo(
    () => [
      {
        key: "current" as const,
        label: "今学期データ",
        filePath: "src/data/sample-students.csv",
        dataset: currentDataset,
      },
      {
        key: "cumulative" as const,
        label: "累計データ",
        filePath: "src/data/cumulative-students.csv",
        dataset: cumulativeDataset,
      },
    ],
    [currentDataset, cumulativeDataset]
  );

  const [datasetKey, setDatasetKey] = useState<"current" | "cumulative">(
    () => datasetOptions[0]?.key ?? "current"
  );

  const activeOption = useMemo(
    () =>
      datasetOptions.find((option) => option.key === datasetKey) ??
      datasetOptions[0],
    [datasetKey, datasetOptions]
  );

  const activeDataset = activeOption?.dataset ?? EMPTY_DATASET;
  const bins = activeDataset.bins;
  const segments = activeDataset.segments;

  const majors = useMemo(() => {
    const unique = new Set(segments.map((segment) => segment.major));
    return Array.from(unique.values());
  }, [segments]);

  const [selectedMajor, setSelectedMajor] = useState(() => majors[0] ?? "");

  const availableGrades = useMemo(() => {
    if (!selectedMajor) {
      return [] as number[];
    }
    const grades = segments
      .filter((segment) => segment.major === selectedMajor)
      .map((segment) => segment.grade)
      .filter((grade) => grade > 0);
    const unique = Array.from(new Set(grades));
    unique.sort((a, b) => a - b);
    return unique;
  }, [segments, selectedMajor]);

  const [selectedGrade, setSelectedGrade] = useState(() =>
    availableGrades.length > 0 ? String(availableGrades[0]) : ""
  );

  useEffect(() => {
    if (majors.length === 0) {
      setSelectedMajor("");
      return;
    }

    if (!selectedMajor || !majors.includes(selectedMajor)) {
      setSelectedMajor(majors[0]);
    }
  }, [majors, selectedMajor]);

  useEffect(() => {
    if (availableGrades.length === 0) {
      setSelectedGrade("");
      return;
    }

    if (
      !selectedGrade ||
      !availableGrades.map(String).includes(selectedGrade)
    ) {
      setSelectedGrade(String(availableGrades[0]));
    }
  }, [availableGrades, selectedGrade]);

  const [gpaInput, setGpaInput] = useState("");

  const selectedSegment = useMemo(() => {
    const gradeNumber = Number.parseInt(selectedGrade, 10);
    if (!selectedMajor || Number.isNaN(gradeNumber)) {
      return null;
    }
    return findSegment(segments, selectedMajor, gradeNumber);
  }, [segments, selectedGrade, selectedMajor]);

  const majorAggregate = useMemo(() => {
    if (!selectedMajor) {
      return { counts: Array.from({ length: bins.length }, () => 0), total: 0 };
    }
    const majorSegments = segments.filter(
      (segment) => segment.major === selectedMajor
    );
    return aggregateSegments(majorSegments, bins.length);
  }, [bins.length, segments, selectedMajor]);

  const overallAggregate = useMemo(
    () => aggregateSegments(segments, bins.length),
    [bins.length, segments]
  );

  const userGpa = Number.parseFloat(gpaInput);
  const hasValidGpa = !Number.isNaN(userGpa);

  const rankInfo = useMemo(
    () => computeRankInfo(selectedSegment, bins, userGpa),
    [bins, selectedSegment, userGpa]
  );

  const gradeAverage = useMemo(
    () =>
      selectedSegment ? weightedAverage(selectedSegment.counts, bins) : null,
    [bins, selectedSegment]
  );

  const majorAverage = useMemo(
    () => weightedAverage(majorAggregate.counts, bins),
    [bins, majorAggregate]
  );

  const overallAverage = useMemo(
    () => weightedAverage(overallAggregate.counts, bins),
    [bins, overallAggregate]
  );

  const chartData = useMemo<ChartData<"bar", number[], string> | null>(() => {
    const counts = selectedSegment?.counts ?? majorAggregate.counts;
    if (!counts || counts.every((value) => value === 0)) {
      return null;
    }

    const datasetLabel = selectedSegment
      ? `${selectedSegment.major} ${selectedSegment.grade}回生`
      : selectedMajor
      ? `${selectedMajor}（全学年）`
      : "分布";

    return {
      labels: bins.map((bin) => bin.label),
      datasets: [
        {
          label: `${datasetLabel} の人数`,
          data: counts,
          backgroundColor: "rgba(99, 102, 241, 0.75)",
          borderRadius: 8,
        },
      ],
    };
  }, [bins, majorAggregate, selectedMajor, selectedSegment]);

  const chartOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "GPA レンジ",
          },
        },
        y: {
          ticks: {
            precision: 0,
          },
          title: {
            display: true,
            text: "人数",
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom" as const,
        },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<"bar">) =>
              `${context.dataset.label ?? "人数"}: ${context.formattedValue}名`,
          },
        },
      },
    }),
    []
  );

  const totalSegments = segments.length;
  const totalStudents = overallAggregate.total;
  const totalCount = selectedSegment?.total ?? 0;
  const gpaMin = bins[0]?.min ?? 0;
  const gpaMax = bins[bins.length - 1]?.max ?? 5;
  const estimatedRank = rankInfo.rank ? Math.round(rankInfo.rank) : null;
  const estimatedPercentile = rankInfo.percentile
    ? Math.min(rankInfo.percentile, 100)
    : null;

  return (
    <div className="page">
      <header className="header">
        <div>
          <p className="eyebrow">学内データ活用</p>
          <h1>GPA Insights Dashboard</h1>
          <p className="lead">
            学校から提供された固定 CSV をもとに、学科×学年ごとの GPA
            分布を可視化し、 自分の位置づけを即座に推定します。
          </p>
        </div>
        <div className="dataset-info">
          <span className="dataset-label">データソース</span>
          <strong>{activeOption?.label ?? "データ未選択"}</strong>
          <span className="dataset-path">{activeOption?.filePath ?? "-"}</span>
          <span>
            {formatCount(totalSegments)} セグメント /{" "}
            {formatCount(totalStudents)} 名
          </span>
        </div>
      </header>

      <main className="content">
        <section className="panel">
          <h2>1. データセット概要</h2>
          <p className="description">
            学校提供の CSV を「今学期」と「累計」で切り替えて分析できます。
            必要に応じて <code>src/data</code> フォルダ内の CSV
            を差し替えてください。
          </p>
          <div
            className="dataset-toggle"
            role="group"
            aria-label="データセット選択"
          >
            {datasetOptions.map((option) => {
              const isActive = option.key === datasetKey;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`dataset-toggle__button${
                    isActive ? " is-active" : ""
                  }`}
                  onClick={() => setDatasetKey(option.key)}
                >
                  <span className="dataset-toggle__label">{option.label}</span>
                  <span className="dataset-toggle__path">
                    {option.filePath.replace("src/data/", "data/")}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hint">CSV ファイルはリポジトリ内で管理されます。</p>
          <ul className="dataset-metrics">
            <li>
              <span>登録セグメント</span>
              <strong>{formatCount(totalSegments)} 件</strong>
            </li>
            <li>
              <span>総学生数</span>
              <strong>{formatCount(totalStudents)} 名</strong>
            </li>
            <li>
              <span>GPA 範囲</span>
              <strong>
                {numberFormatter(2).format(gpaMin)} 〜{" "}
                {numberFormatter(2).format(gpaMax)}
              </strong>
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2>2. 自分の情報を入力</h2>
          <div className="form-grid">
            <label>
              <span>学科</span>
              <select
                value={selectedMajor}
                onChange={(event) => setSelectedMajor(event.target.value)}
              >
                {majors.map((major) => (
                  <option key={major} value={major}>
                    {major}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>学年</span>
              <select
                value={selectedGrade}
                onChange={(event) => setSelectedGrade(event.target.value)}
                disabled={availableGrades.length === 0}
              >
                {availableGrades.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}回生
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>あなたの GPA</span>
              <input
                type="number"
                step="0.01"
                min={gpaMin}
                max={gpaMax}
                value={gpaInput}
                onChange={(event) => setGpaInput(event.target.value)}
                placeholder="例: 3.85"
              />
            </label>
          </div>
          <p className="hint">
            ※ GPA は {numberFormatter(2).format(gpaMin)} 〜{" "}
            {numberFormatter(2).format(gpaMax)} の範囲で近似計算します。
          </p>
        </section>

        <section className="panel">
          <h2>3. 推定結果</h2>
          <div className="stats-grid">
            <article className="stat-card">
              <p className="stat-label">対象人数</p>
              <p className="stat-value">{formatCount(totalCount)} 名</p>
              <p className="stat-detail">
                {selectedSegment
                  ? `${selectedSegment.major} ${selectedSegment.grade}回生（${
                      activeOption?.label ?? ""
                    }）`
                  : "学科・学年を選択してください"}
              </p>
            </article>
            <article className="stat-card">
              <p className="stat-label">平均 GPA（学年）</p>
              <p className="stat-value">{formatDecimal(gradeAverage)}</p>
              <p className="stat-detail">選択したセグメントの加重平均</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">平均 GPA（学科）</p>
              <p className="stat-value">{formatDecimal(majorAverage)}</p>
              <p className="stat-detail">同学科の全学年を対象</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">平均 GPA（全体）</p>
              <p className="stat-value">{formatDecimal(overallAverage)}</p>
              <p className="stat-detail">CSV に含まれる全学生</p>
            </article>
          </div>

          <div className="result-callout">
            <div>
              <h3>あなたの推定順位</h3>
              <p>
                {selectedSegment && hasValidGpa
                  ? estimatedRank && estimatedPercentile !== null
                    ? `${formatCount(totalCount)} 名中 推定 ${formatCount(
                        estimatedRank
                      )} 位（${
                        activeOption?.label ?? "対象"
                      } / 上位 ${formatDecimal(estimatedPercentile, 1)}%）`
                    : "対象人数が少ないため順位を推定できません"
                  : "学科・学年と GPA を入力すると順位を推定します"}
              </p>
            </div>
            <p className="result-note">
              ※ ビンごとの人数から一様分布と仮定して近似しています。
            </p>
          </div>
        </section>

        <section className="panel">
          <h2>4. 分布を確認</h2>
          <div className="chart-wrapper">
            {chartData ? (
              <Bar data={chartData} options={chartOptions} />
            ) : (
              <p className="placeholder">
                学科・学年を選択すると分布グラフが表示されます。
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>
          CSV の構造を変更する場合は <code>src/data/sample-students.csv</code>{" "}
          を基準に列（学科・学年 / GPA レンジ）を編集してください。
        </p>
      </footer>
    </div>
  );
};

export default App;
