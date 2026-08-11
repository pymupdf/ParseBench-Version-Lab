alter table public.benchmark_cases
    add column source_relative_path text,
    add column source_media_type text;

comment on column public.benchmark_cases.source_relative_path is
    'Dataset-relative path to the exact source asset used by the benchmark case.';

comment on column public.benchmark_cases.source_media_type is
    'Media type of the source asset, for example application/pdf or image/png.';

update public.benchmark_cases
set
    source_relative_path = pdf_relative_path,
    source_media_type = case
        when pdf_relative_path is not null then 'application/pdf'
        else null
    end;

-- Repair the image-backed layout cases in the pinned full ParseBench revision.
-- Future indexing obtains these paths from EvaluationResult or the pinned Hub manifest.
with image_assets(test_id, source_relative_path, source_media_type) as (
    values
        ('layout/00102', 'docs/layout/00102.jpg', 'image/jpeg'),
        ('layout/01114', 'docs/layout/01114.jpg', 'image/jpeg'),
        ('layout/01205', 'docs/layout/01205.jpg', 'image/jpeg'),
        ('layout/01305', 'docs/layout/01305.jpg', 'image/jpeg'),
        ('layout/01744', 'docs/layout/01744.jpg', 'image/jpeg'),
        ('layout/01766', 'docs/layout/01766.jpg', 'image/jpeg'),
        ('layout/01831', 'docs/layout/01831.jpg', 'image/jpeg'),
        ('layout/03016', 'docs/layout/03016.jpg', 'image/jpeg'),
        ('layout/13153', 'docs/layout/13153.png', 'image/png'),
        ('layout/16804', 'docs/layout/16804.png', 'image/png'),
        ('layout/16968', 'docs/layout/16968.png', 'image/png'),
        ('layout/17256', 'docs/layout/17256.png', 'image/png'),
        ('layout/2031426764', 'docs/layout/2031426764.jpg', 'image/jpeg'),
        ('layout/2050247507', 'docs/layout/2050247507.jpg', 'image/jpeg'),
        ('layout/2072665602', 'docs/layout/2072665602.jpg', 'image/jpeg'),
        ('layout/2072877887', 'docs/layout/2072877887.jpg', 'image/jpeg'),
        ('layout/2073365529_5534', 'docs/layout/2073365529_5534.jpg', 'image/jpeg'),
        ('layout/2076128735_8736', 'docs/layout/2076128735_8736.jpg', 'image/jpeg'),
        ('layout/2562', 'docs/layout/2562.png', 'image/png'),
        ('layout/289', 'docs/layout/289.png', 'image/png'),
        ('layout/3887', 'docs/layout/3887.png', 'image/png'),
        ('layout/40024983-4986', 'docs/layout/40024983-4986.jpg', 'image/jpeg'),
        ('layout/40033964-3964', 'docs/layout/40033964-3964.jpg', 'image/jpeg'),
        ('layout/40036154-6154', 'docs/layout/40036154-6154.jpg', 'image/jpeg'),
        ('layout/44809044006439', 'docs/layout/44809044006439.png', 'image/png'),
        ('layout/4576', 'docs/layout/4576.png', 'image/png'),
        ('layout/47413894001985', 'docs/layout/47413894001985.png', 'image/png'),
        ('layout/50608376-8377', 'docs/layout/50608376-8377.jpg', 'image/jpeg'),
        ('layout/50625168000470', 'docs/layout/50625168000470.png', 'image/png'),
        ('layout/50650671-0672', 'docs/layout/50650671-0672.jpg', 'image/jpeg'),
        ('layout/5734', 'docs/layout/5734.png', 'image/png'),
        ('layout/71153406', 'docs/layout/71153406.jpg', 'image/jpeg'),
        ('layout/85418261', 'docs/layout/85418261.jpg', 'image/jpeg'),
        ('layout/89955590', 'docs/layout/89955590.jpg', 'image/jpeg'),
        ('layout/OECD_LABOUR_PRODUCTIVITY_FORECAST_AUT_JPN_NOR_NZL_SVN_000076', 'docs/layout/OECD_LABOUR_PRODUCTIVITY_FORECAST_AUT_JPN_NOR_NZL_SVN_000076.png', 'image/png'),
        ('layout/gr-f-14.05.01.06a', 'docs/layout/gr-f-14.05.01.06a.png', 'image/png'),
        ('layout/multi_col_40477', 'docs/layout/multi_col_40477.png', 'image/png'),
        ('layout/multi_col_40665', 'docs/layout/multi_col_40665.png', 'image/png'),
        ('layout/multi_col_60411', 'docs/layout/multi_col_60411.png', 'image/png'),
        ('layout/nvidia_p92_1', 'docs/layout/nvidia_p92_1.jpg', 'image/jpeg'),
        ('layout/smokers', 'docs/layout/smokers.png', 'image/png'),
        ('layout/two_col_104731', 'docs/layout/two_col_104731.png', 'image/png')
)
update public.benchmark_cases as benchmark_case
set
    source_relative_path = image_asset.source_relative_path,
    source_media_type = image_asset.source_media_type,
    pdf_relative_path = null
from image_assets as image_asset
join public.dataset_versions as dataset_version
    on dataset_version.repository = 'llamaindex/ParseBench'
    and dataset_version.resolved_sha = '2805a1d940f95a203e0ae4b88be9934f7765b3fc'
where benchmark_case.dataset_version_id = dataset_version.id
  and benchmark_case.test_id = image_asset.test_id;
