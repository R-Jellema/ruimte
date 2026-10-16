-- Daily totals of the anonymous usage statistics, written by the stats worker from Analytics Engine, which keeps three months.
-- A row is one metric of one day: across every machine when `dimension` is empty, else for one value of that dimension.
-- The worker replaces every row of a date at once, so a day rolled up again holds the late batches too.
CREATE TABLE usage_daily (
    date TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    metric TEXT NOT NULL,
    total REAL NOT NULL,
    PRIMARY KEY (date, dimension, value, metric)
);
