-- fold_unique_name_v1 is frozen once applied: a rule change ships as
-- fold_unique_name_v2 plus a column and index rebuild, never an edit here.
-- Forward recovery: no table references this function yet, so a later migration
-- can drop it outright.
CREATE FUNCTION fold_unique_name_v1(raw_name text) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	STRICT
	PARALLEL SAFE
	RETURN lower(
		btrim(
			-- unicode spaces are folded here because PostgreSQL regex \s matches
			-- neither NBSP nor the U+2000-200A family
			regexp_replace(
				-- extended arabic-indic and arabic-indic digits to ascii
				translate(
					-- yeh, alef maksura and yeh with hamza to farsi yeh; waw with hamza to
					-- waw; alef with hamza above or below and alef wasla to alef; arabic
					-- kaf to keheh; teh marbuta, heh with yeh above and ae to heh. Alef
					-- with madda (U+0622) is meaning-bearing and deliberately stays distinct.
					translate(
						-- zero-width marks including ZWNJ, bidi controls, tatweel, harakat
						-- and superscript alef
						regexp_replace(
							normalize(raw_name, NFKC),
							'[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u0640\u0610-\u061A\u064B-\u0655\u0670]',
							'',
							'g'
						),
						U&'\064A\0649\0626\0624\0623\0625\0671\0643\0629\06C0\06D5',
						U&'\06CC\06CC\06CC\0648\0627\0627\0627\06A9\0647\0647\0647'
					),
					U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669',
					'01234567890123456789'
				),
				'[\s\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+',
				' ',
				'g'
			)
		) COLLATE "pg_c_utf8"
	);
