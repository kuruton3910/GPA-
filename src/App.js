import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import currentTermCsv from "./data/sample-students.csv?raw";
import cumulativeCsv from "./data/cumulative-students.csv?raw";
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);
const EMPTY_DATASET = { bins: [], segments: [] };
const numberFormatter = (fraction = 2) =>
  new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  });
const formatDecimal = (value, fraction = 2) =>
  value === null ? "-" : numberFormatter(fraction).format(value);
const formatCount = (value) => value.toLocaleString("ja-JP");
const sumCounts = (counts) => counts.reduce((sum, value) => sum + value, 0);
const weightedAverage = (counts, bins) => {
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
const aggregateSegments = (segments, binLength) => {
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
const parseRange = (label) => {
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
const parseDistributionCsv = (raw) => {
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
  const segments = lines.slice(1).flatMap((line) => {
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
const findSegment = (segments, major, grade) =>
  segments.find(
    (segment) => segment.major === major && segment.grade === grade
  ) ?? null;
const computeRankInfo = (segment, bins, rawGpa) => {
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
        key: "current",
        label: "今学期データ",
        filePath: "src/data/sample-students.csv",
        dataset: currentDataset,
      },
      {
        key: "cumulative",
        label: "累計データ",
        filePath: "src/data/cumulative-students.csv",
        dataset: cumulativeDataset,
      },
    ],
    [currentDataset, cumulativeDataset]
  );
  const [datasetKey, setDatasetKey] = useState(
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
      return [];
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
  const gradeAggregate = useMemo(() => {
    const gradeNumber = Number.parseInt(selectedGrade, 10);
    if (Number.isNaN(gradeNumber)) {
      return { counts: Array.from({ length: bins.length }, () => 0), total: 0 };
    }
    const gradeSegments = segments.filter(
      (segment) => segment.grade === gradeNumber
    );
    return aggregateSegments(gradeSegments, bins.length);
  }, [bins.length, segments, selectedGrade]);
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
  const highlightBinIndex = useMemo(() => {
    if (!hasValidGpa || bins.length === 0) {
      return null;
    }
    const minBound = bins[0].min;
    const maxBound = bins[bins.length - 1].max;
    const clampedGpa = Math.min(Math.max(userGpa, minBound), maxBound);
    let index = bins.findIndex((bin, binIndex) => {
      const upper = binIndex === bins.length - 1 ? bin.max : bin.max + 0.0001;
      return clampedGpa >= bin.min && clampedGpa <= upper;
    });
    if (index === -1) {
      index = bins.length - 1;
    }
    return index;
  }, [bins, hasValidGpa, userGpa]);
  const gradeAverage = useMemo(
    () => weightedAverage(gradeAggregate.counts, bins),
    [bins, gradeAggregate]
  );
  const segmentAverage = useMemo(
    () =>
      selectedSegment ? weightedAverage(selectedSegment.counts, bins) : null,
    [bins, selectedSegment]
  );
  const chartData = useMemo(() => {
    const counts = selectedSegment?.counts ?? gradeAggregate.counts;
    if (!counts || counts.every((value) => value === 0)) {
      return null;
    }
    const gradeNumber = Number.parseInt(selectedGrade, 10);
    const gradeLabel = Number.isNaN(gradeNumber) ? "" : `${gradeNumber}回生`;
    const datasetLabel = selectedSegment
      ? `${selectedSegment.major} ${selectedSegment.grade}回生`
      : gradeLabel
      ? `${gradeLabel} 全体`
      : "分布";
    const baseColor = "rgba(99, 102, 241, 0.75)";
    const baseHoverColor = "rgba(79, 70, 229, 0.85)";
    const baseBorderColor = "rgba(67, 56, 202, 1)";
    const accentColor = "rgba(239, 68, 68, 0.85)";
    const accentHoverColor = "rgba(220, 38, 38, 0.9)";
    const accentBorderColor = "rgba(185, 28, 28, 1)";
    const highlightIndex = highlightBinIndex ?? -1;
    const backgroundColors = counts.map((_, index) =>
      index === highlightIndex ? accentColor : baseColor
    );
    const hoverBackgroundColors = counts.map((_, index) =>
      index === highlightIndex ? accentHoverColor : baseHoverColor
    );
    const borderColors = counts.map((_, index) =>
      index === highlightIndex ? accentBorderColor : baseBorderColor
    );
    const borderWidths = counts.map((_, index) =>
      index === highlightIndex ? 2 : 0
    );
    return {
      labels: bins.map((bin) => bin.label),
      datasets: [
        {
          label: `${datasetLabel} の人数`,
          data: counts,
          backgroundColor: backgroundColors,
          hoverBackgroundColor: hoverBackgroundColors,
          borderColor: borderColors,
          borderWidth: borderWidths,
          borderRadius: 8,
        },
      ],
    };
  }, [bins, gradeAggregate, highlightBinIndex, selectedGrade, selectedSegment]);
  const chartOptions = useMemo(
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
          position: "bottom",
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.dataset.label ?? "人数"}: ${context.formattedValue}名`,
          },
        },
      },
    }),
    []
  );
  const totalSegments = segments.length;
  const totalStudents = overallAggregate.total;
  const gradeTotal = gradeAggregate.total;
  const segmentTotal = selectedSegment?.total ?? 0;
  const gpaMin = bins[0]?.min ?? 0;
  const gpaMax = bins[bins.length - 1]?.max ?? 5;
  const estimatedRank = rankInfo.rank ? Math.round(rankInfo.rank) : null;
  const estimatedPercentile = rankInfo.percentile
    ? Math.min(rankInfo.percentile, 100)
    : null;
  return _jsxs("div", {
    className: "page",
    children: [
      _jsxs("header", {
        className: "header",
        children: [
          _jsxs("div", {
            children: [
              _jsx("p", {
                className: "eyebrow",
                children: "\u5B66\u5185\u30C7\u30FC\u30BF\u6D3B\u7528",
              }),
              _jsx("h1", { children: "\u307F\u3093\u306A\u306EGPA" }),
              _jsx("p", {
                className: "lead",
                children:
                  "\u5B66\u6821\u304B\u3089\u63D0\u4F9B\u3055\u308C\u305F\u30C7\u30FC\u30BF\u3092\u3082\u3068\u306B\u3001\u5B66\u79D1\u00D7\u5B66\u5E74\u3054\u3068\u306E GPA \u5206\u5E03\u3092\u53EF\u8996\u5316\u3057\u3001 \u81EA\u5206\u306E\u4F4D\u7F6E\u3065\u3051\u3092\u5373\u5EA7\u306B\u63A8\u5B9A\u3057\u307E\u3059\u3002",
              }),
            ],
          }),
          _jsxs("div", {
            className: "dataset-info",
            children: [
              _jsx("span", {
                className: "dataset-label",
                children: "\u30C7\u30FC\u30BF\u30BD\u30FC\u30B9",
              }),
              _jsx("strong", {
                children: activeOption?.label ?? "データ未選択",
              }),
              _jsxs("span", {
                children: [
                  formatCount(totalSegments),
                  " \u30BB\u30B0\u30E1\u30F3\u30C8 /",
                  " ",
                  formatCount(totalStudents),
                  " \u540D",
                ],
              }),
            ],
          }),
        ],
      }),
      _jsxs("main", {
        className: "content",
        children: [
          _jsxs("section", {
            className: "panel",
            children: [
              _jsx("h2", {
                children: "1. \u30C7\u30FC\u30BF\u30BB\u30C3\u30C8\u6982\u8981",
              }),
              _jsx("p", {
                className: "description",
                children:
                  "\u5B66\u6821\u63D0\u4F9B\u306E\u30C7\u30FC\u30BF\u3092\u300C\u4ECA\u5B66\u671F*\u300D\u5E74\u5EA6\u3068\u300C\u7D2F\u8A08\u300D\u3067\u5207\u308A\u66FF\u3048\u3066\u5206\u6790\u3067\u304D\u307E\u3059\u3002",
              }),
              _jsx("div", {
                className: "dataset-toggle",
                role: "group",
                "aria-label":
                  "\u30C7\u30FC\u30BF\u30BB\u30C3\u30C8\u9078\u629E",
                children: datasetOptions.map((option) => {
                  const isActive = option.key === datasetKey;
                  return _jsx(
                    "button",
                    {
                      type: "button",
                      className: `dataset-toggle__button${
                        isActive ? " is-active" : ""
                      }`,
                      onClick: () => setDatasetKey(option.key),
                      children: _jsx("span", {
                        className: "dataset-toggle__label",
                        children: option.label,
                      }),
                    },
                    option.key
                  );
                }),
              }),
              _jsxs("ul", {
                className: "dataset-metrics",
                children: [
                  _jsxs("li", {
                    children: [
                      _jsx("span", {
                        children: "\u767B\u9332\u30BB\u30B0\u30E1\u30F3\u30C8",
                      }),
                      _jsxs("strong", {
                        children: [formatCount(totalSegments), " \u4EF6"],
                      }),
                    ],
                  }),
                  _jsxs("li", {
                    children: [
                      _jsx("span", { children: "\u7DCF\u5B66\u751F\u6570" }),
                      _jsxs("strong", {
                        children: [formatCount(totalStudents), " \u540D"],
                      }),
                    ],
                  }),
                  _jsxs("li", {
                    children: [
                      _jsx("span", { children: "GPA \u7BC4\u56F2" }),
                      _jsxs("strong", {
                        children: [
                          numberFormatter(2).format(gpaMin),
                          " \u301C",
                          " ",
                          numberFormatter(2).format(gpaMax),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          _jsxs("section", {
            className: "panel",
            children: [
              _jsx("h2", {
                children: "2. \u81EA\u5206\u306E\u60C5\u5831\u3092\u5165\u529B",
              }),
              _jsxs("div", {
                className: "form-grid",
                children: [
                  _jsxs("label", {
                    children: [
                      _jsx("span", { children: "\u5B66\u79D1" }),
                      _jsx("select", {
                        value: selectedMajor,
                        onChange: (event) =>
                          setSelectedMajor(event.target.value),
                        children: majors.map((major) =>
                          _jsx(
                            "option",
                            { value: major, children: major },
                            major
                          )
                        ),
                      }),
                    ],
                  }),
                  _jsxs("label", {
                    children: [
                      _jsx("span", { children: "\u5B66\u5E74" }),
                      _jsx("select", {
                        value: selectedGrade,
                        onChange: (event) =>
                          setSelectedGrade(event.target.value),
                        disabled: availableGrades.length === 0,
                        children: availableGrades.map((grade) =>
                          _jsxs(
                            "option",
                            { value: grade, children: [grade, "\u56DE\u751F"] },
                            grade
                          )
                        ),
                      }),
                    ],
                  }),
                  _jsxs("label", {
                    children: [
                      _jsx("span", {
                        children: "\u3042\u306A\u305F\u306E GPA",
                      }),
                      _jsx("input", {
                        type: "number",
                        step: "0.01",
                        min: gpaMin,
                        max: gpaMax,
                        value: gpaInput,
                        onChange: (event) => setGpaInput(event.target.value),
                        placeholder: "\u4F8B: 3.85",
                      }),
                    ],
                  }),
                ],
              }),
              _jsxs("p", {
                className: "hint",
                children: [
                  "\u203B GPA \u306F ",
                  numberFormatter(2).format(gpaMin),
                  " \u301C",
                  " ",
                  numberFormatter(2).format(gpaMax),
                  " \u306E\u7BC4\u56F2\u3067\u8FD1\u4F3C\u8A08\u7B97\u3057\u307E\u3059\u3002",
                ],
              }),
            ],
          }),
          _jsxs("section", {
            className: "panel",
            children: [
              _jsx("h2", { children: "3. \u63A8\u5B9A\u7D50\u679C" }),
              _jsxs("div", {
                className: "stats-grid",
                children: [
                  _jsxs("article", {
                    className: "stat-card",
                    children: [
                      _jsx("p", {
                        className: "stat-label",
                        children: "\u5BFE\u8C61\u4EBA\u6570",
                      }),
                      _jsxs("p", {
                        className: "stat-value",
                        children: [formatCount(segmentTotal), " \u540D"],
                      }),
                      _jsx("p", {
                        className: "stat-detail",
                        children: selectedSegment
                          ? `${selectedSegment.major} ${
                              selectedSegment.grade
                            }回生（${activeOption?.label ?? ""}）`
                          : "学科・学年を選択してください",
                      }),
                    ],
                  }),
                  _jsxs("article", {
                    className: "stat-card",
                    children: [
                      _jsx("p", {
                        className: "stat-label",
                        children: "\u5E73\u5747 GPA\uFF08\u5B66\u5E74\uFF09",
                      }),
                      _jsx("p", {
                        className: "stat-value",
                        children: formatDecimal(gradeAverage),
                      }),
                      _jsx("p", {
                        className: "stat-detail",
                        children: selectedGrade
                          ? `理工学部 ${selectedGrade}回生（${formatCount(
                              gradeTotal
                            )} 名対象）`
                          : "学年を選択してください",
                      }),
                    ],
                  }),
                  _jsxs("article", {
                    className: "stat-card",
                    children: [
                      _jsx("p", {
                        className: "stat-label",
                        children:
                          "\u5E73\u5747 GPA\uFF08\u5B66\u79D1\u00D7\u5B66\u5E74\uFF09",
                      }),
                      _jsx("p", {
                        className: "stat-value",
                        children: formatDecimal(segmentAverage),
                      }),
                      _jsx("p", {
                        className: "stat-detail",
                        children: selectedSegment
                          ? `${selectedSegment.major} ${selectedSegment.grade}回生の加重平均`
                          : "学科・学年を選択してください",
                      }),
                    ],
                  }),
                ],
              }),
              _jsxs("div", {
                className: "result-callout",
                children: [
                  _jsxs("div", {
                    children: [
                      _jsx("h3", {
                        children:
                          "\u3042\u306A\u305F\u306E\u63A8\u5B9A\u9806\u4F4D",
                      }),
                      _jsx("p", {
                        children:
                          selectedSegment && hasValidGpa
                            ? estimatedRank && estimatedPercentile !== null
                              ? `${formatCount(
                                  segmentTotal
                                )} 名中 推定 ${formatCount(
                                  estimatedRank
                                )} 位（${
                                  activeOption?.label ?? "対象"
                                } / 上位 ${formatDecimal(
                                  estimatedPercentile,
                                  1
                                )}%）`
                              : "対象人数が少ないため順位を推定できません"
                            : "学科・学年と GPA を入力すると順位を推定します",
                      }),
                    ],
                  }),
                  _jsx("p", {
                    className: "result-note",
                    children:
                      "\u203B \u30D3\u30F3\u3054\u3068\u306E\u4EBA\u6570\u304B\u3089\u4E00\u69D8\u5206\u5E03\u3068\u4EEE\u5B9A\u3057\u3066\u8FD1\u4F3C\u3057\u3066\u3044\u307E\u3059\u3002",
                  }),
                ],
              }),
            ],
          }),
          _jsxs("section", {
            className: "panel",
            children: [
              _jsx("h2", { children: "4. \u5206\u5E03\u3092\u78BA\u8A8D" }),
              _jsx("div", {
                className: "chart-wrapper",
                children: chartData
                  ? _jsx(Bar, { data: chartData, options: chartOptions })
                  : _jsx("p", {
                      className: "placeholder",
                      children:
                        "\u5B66\u79D1\u30FB\u5B66\u5E74\u3092\u9078\u629E\u3059\u308B\u3068\u5206\u5E03\u30B0\u30E9\u30D5\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002",
                    }),
              }),
            ],
          }),
        ],
      }),
      _jsx("footer", {
        className: "footer",
        children: _jsx("p", { children: "*2025\u5E74\u5EA6" }),
      }),
    ],
  });
};
export default App;
