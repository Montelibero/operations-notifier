# Примеры ответов (Notification Payloads)

Этот документ содержит примеры JSON-ответов, которые Operations Notifier отправляет на `reaction_url` подписчиков.

## Структура ответа

```json
{
  "id": "notification-id",
  "subscription": "subscription-id",
  "type": "operation",
  "created": "2026-01-27T15:37:29.204Z",
  "sent": "2026-01-27T15:37:29.204Z",
  "operation": { ... },
  "transaction": { ... }
}
```

---

## 0 | create_account

```json
{
  "operation": {
    "type_i": 0,
    "type": "create_account",
    "destination": "GBHQUKP4D456KEW3GIG6EWCREFFHNWREQQS7RZHJNQECG57AWXRG67A3",
    "asset": {
      "asset_type": 0
    },
    "amount": "1.5000000",
    "id": "261832540782891009",
    "account": "GDNHPXSFIZQMJJFBAFWUWG3442AHGI3WEWUYRYXIGMJRHDUQOPHTKLDC"
  },
  "transaction": {
    "hash": "3876f834fc12c2a57bf9b1cd4a21b8ee32f65c850d52a20860d5942bc5773568",
    "fee": "400",
    "fee_charged": "200",
    "max_fee": "400",
    "source": "GDNHPXSFIZQMJJFBAFWUWG3442AHGI3WEWUYRYXIGMJRHDUQOPHTKLDC",
    "paging_token": "261832540782891008",
    "source_account_sequence": "255319476281840155",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 1 | payment

```json
{
  "operation": {
    "type_i": 1,
    "type": "payment",
    "destination": "GBEPZKYCZBZV2AM4C4A6NFAC2RJKVHUZ6HRQ3JFMZGLK442LHBMK2SG2",
    "asset": {
      "asset_type": 2,
      "asset_code": "STARDUST",
      "asset_issuer": "GCPLNANLXTV2G6NPIRDPOLM5NAO5XH2IPYQBZCTTAKPNV4IRTU5X5B4S"
    },
    "amount": "782.3732980",
    "id": "261832540782858241",
    "account": "GCPLNANLXTV2G6NPIRDPOLM5NAO5XH2IPYQBZCTTAKPNV4IRTU5X5B4S"
  },
  "transaction": {
    "hash": "36374dc3083442f6e180b2f301f6b7490d84e666e783175498e05019d8eda653",
    "fee": "1000000",
    "fee_charged": "100",
    "max_fee": "1000000",
    "source": "GCAKUQIS5SPYL2ZULHQR6VBILUMT65EMPQMQRKBPWJGPZYH7RXP5OPEY",
    "paging_token": "261832540782858240",
    "source_account_sequence": "214646969212127004",
    "created_at": "2026-01-27T15:37:22Z",
    "memo": {
      "type": "text",
      "value": "staking reward: 3e3d…ec1e"
    }
  }
}
```

---

## 2 | path_payment_strict_receive

```json
{
  "operation": {
    "type_i": 2,
    "type": "path_payment_strict_receive",
    "asset": {
      "asset_type": 0
    },
    "amount": "0.7107142",
    "source_asset": {
      "asset_type": 0
    },
    "source_max": {
      "asset_type": 0
    },
    "path": [
      { "asset_type": 1, "asset_code": "SHX", "asset_issuer": "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH" },
      { "asset_type": 2, "asset_code": "TREAD", "asset_issuer": "GANMKTF7SVYEHZ4CTLRKT2MG2OUJNDEA3JGZGTUTHQZOZSWJHHUF6VLM" },
      { "asset_type": 2, "asset_code": "BTCLN", "asset_issuer": "GDPKQ2TSNJOFSEE7XSUXPWRP27H6GFGLWD7JCHNEYYWQVGFA543EVBVT" },
      { "asset_type": 1, "asset_code": "ZARZ", "asset_issuer": "GAROH4EV3WVVTRQKEY43GZK3XSRBEYETRVZ7SVG5LHWOAANSMCTJBB3U" },
      { "asset_type": 1, "asset_code": "USDC", "asset_issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }
    ],
    "id": "261832532194631681",
    "account": "GDHAJO6CSLXVK4XDQ7MPG2CEI4GCAPLHDXTRRWG5SOEHLGDLZSBVMAUK",
    "trades": [
      { "type": "order_book", "seller_id": "GAGWF3VFKPC7EUNYHE6UX5OZODILTCDLK4J24BBY7KT5B25QRXRUZUPL", "offer_id": "1820871911", "asset_sold": { "asset_type": 1, "asset_code": "SHX", "asset_issuer": "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH" }, "amount_sold": "183626770", "asset_bought": { "asset_type": 0 }, "amount_bought": "7095890" },
      { "type": "liquidity_pool", "pool_id": "dab2cc28955e5ad39d519f592ad75b54ee5b8ec93b5f24a6d80c04e92177ddc7", "asset_sold": { "asset_type": 2, "asset_code": "TREAD", "asset_issuer": "GANMKTF7SVYEHZ4CTLRKT2MG2OUJNDEA3JGZGTUTHQZOZSWJHHUF6VLM" }, "amount_sold": "1716083", "asset_bought": { "asset_type": 1, "asset_code": "SHX", "asset_issuer": "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH" }, "amount_bought": "183626770" }
    ]
  },
  "transaction": {
    "hash": "d2b9ad505cec17d07cf19ebcb995a524192a5c798365a6e2db1ccb06ba2f08c3",
    "fee": "10000000",
    "fee_charged": "100",
    "max_fee": "10000000",
    "source": "GDHAJO6CSLXVK4XDQ7MPG2CEI4GCAPLHDXTRRWG5SOEHLGDLZSBVMAUK",
    "paging_token": "261832532194631680",
    "source_account_sequence": "259495249645161455",
    "created_at": "2026-01-27T15:37:10Z"
  }
}
```

---

## 3 | manage_sell_offer

```json
{
  "operation": {
    "type_i": 3,
    "type": "manage_sell_offer",
    "asset": {
      "asset_type": 0
    },
    "amount": "169744.2190799",
    "source_asset": {
      "asset_type": 1,
      "asset_code": "Pi",
      "asset_issuer": "GDSDCJYXH4VRB7CXGOMUKREM5HU3EV3ECYDD2HDD5HJUVQWGM2MGA33T"
    },
    "price": "0.0000501",
    "offerId": "1770725095",
    "id": "261832540782870529",
    "account": "GAZSKD4VESGLQNLJTHHPDYH4G5QUQ5BCB5GOSPYUJSU32Q55QQDNTQ7C"
  },
  "transaction": {
    "hash": "293162bf7e3a4f6e5855a66d6b7015523605196989759cd0266b07787bd3bf5a",
    "fee": "100",
    "fee_charged": "100",
    "max_fee": "100",
    "source": "GAZSKD4VESGLQNLJTHHPDYH4G5QUQ5BCB5GOSPYUJSU32Q55QQDNTQ7C",
    "paging_token": "261832540782870528",
    "source_account_sequence": "183923006559635841",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 4 | create_passive_sell_offer

```json
{
  "operation": {
    "type_i": 4,
    "type": "create_passive_sell_offer",
    "asset": {
      "asset_type": 2,
      "asset_code": "EUROMUT",
      "asset_issuer": "GCNKX5DV74T22BWQKQZ4SIOSDAKWJKFK7ODR4FHTAB6EPW2GDX7EOMUT"
    },
    "amount": "80.0000000",
    "source_asset": {
      "asset_type": 2,
      "asset_code": "EURMTL",
      "asset_issuer": "GACKTN5DAZGWXRWB2WLM6OPBDHAMT6SJNGLJZPQMEZBUR4JUGBX2UK7V"
    },
    "price": "1",
    "id": "243688232397656065",
    "account": "GCNKX5DV74T22BWQKQZ4SIOSDAKWJKFK7ODR4FHTAB6EPW2GDX7EOMUT"
  },
  "transaction": {
    "hash": "ca1946ee4f4a9a59702f1b2df26373cae3e146cefb5416472a003fe0ba42c6b2",
    "source": "GCNKX5DV74T22BWQKQZ4SIOSDAKWJKFK7ODR4FHTAB6EPW2GDX7EOMUT",
    "paging_token": "243688232397656064",
    "created_at": "2025-06-05T..."
  }
}

---

## 5 | set_options

```json
{
  "operation": {
    "type_i": 5,
    "type": "set_options",
    "inflation_dest": "GDCHDRSDOBRMSUDKRE2C4U4KDLNEATJPIHHR2ORFL5BSD56G4DQXL4VW",
    "home_domain": "lobstr.co",
    "id": "261832536487911426",
    "account": "GDPISZKKDXHB7Q7DRAYBSPMR2Z6REPDHO7KKVCJTMQNVIU3K46YFUJ33"
  },
  "transaction": {
    "hash": "62f47c26e713f704aaa641c7f2a3e16a4d25946b9fa2c34b2fc45828e440836c",
    "fee": "200000",
    "fee_charged": "200",
    "max_fee": "200000",
    "source": "GDPISZKKDXHB7Q7DRAYBSPMR2Z6REPDHO7KKVCJTMQNVIU3K46YFUJ33",
    "paging_token": "261832536487911424",
    "source_account_sequence": "259561834523131905",
    "created_at": "2026-01-27T15:37:16Z"
  }
}
```

---

## 6 | change_trust

```json
{
  "operation": {
    "type_i": 6,
    "type": "change_trust",
    "asset": {
      "asset_type": 2,
      "asset_code": "dSTARDUST",
      "asset_issuer": "GCUXCKROP3B353YX2CGDAFB4ADKLGPFG4LLFU7CLHSELVOP4LAXDIYF7"
    },
    "limit": "922337203685.4775807",
    "id": "261832540782972930",
    "account": "GAFI2AOGBCKV7DWK2N77O34RD52C6O6QGGVEV5CEVFQTCHOOI3VOKP7G"
  },
  "transaction": {
    "hash": "bb51541ae52a26ad2ab90036a881e596ae02aa90c1bf17ca4cdfe3dadbea0612",
    "fee": "7000000",
    "fee_charged": "700",
    "max_fee": "7000000",
    "source": "GDN5YRNIP7X4IHGPBAASBWMVUCVKZG4VKSLWRMYDV4MMOCVM3VH6JLCT",
    "paging_token": "261832540782972928",
    "source_account_sequence": "166132650724097100",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 7 | allow_trust

*Deprecated - заменён на set_trustline_flags (21)*

---

## 8 | account_merge

```json
{
  "operation": {
    "type_i": 8,
    "type": "account_merge",
    "destination": "GBMUZ7DCFWJ47CI2FGFR4NIVSZNPPZENJJWNG7THSRWQWFZVNUNZJTR4",
    "id": "261832536488607745",
    "account": "GDGUB7FUPTRENYRXYTK4BEBOUPEGRDXQJRKRCFDZW5J5OTAX7IPSPNEX"
  },
  "transaction": {
    "hash": "84580e17fc1cd23c48c73eb71f583df69ffae32ce0ce7bbaa253d85543bc9295",
    "fee": "100000",
    "fee_charged": "100",
    "max_fee": "100000",
    "source": "GDGUB7FUPTRENYRXYTK4BEBOUPEGRDXQJRKRCFDZW5J5OTAX7IPSPNEX",
    "paging_token": "261832536488607744",
    "source_account_sequence": "261831802048479235",
    "created_at": "2026-01-27T15:37:16Z"
  }
}
```

---

## 9 | inflation

*Deprecated - операция больше не используется в сети*

---

## 10 | manage_data

```json
{
  "operation": {
    "type_i": 10,
    "type": "manage_data",
    "name": "jid",
    "value": {
      "type": "Buffer",
      "data": [51, 56, 113, 88, 101, 88, 78, 57, 50, 53, 89, 105, 82, 115, 78, 48, 65, 76, 121, 73, 101, 116, 107, 102, 97, 119, 68]
    },
    "id": "261832489243934723",
    "account": "GCZZB7MIU6CIJT5RVFWC2YO2WGIXE3WWZKIBBXOTGBZPPCQJW66BDXET"
  },
  "transaction": {
    "hash": "e492276824d5345e4a804746bfe0f6566a7a91b486c55897a706377d89254dc4",
    "fee": "120000000",
    "fee_charged": "1300",
    "max_fee": "1575600000",
    "source": "GCZZB7MIU6CIJT5RVFWC2YO2WGIXE3WWZKIBBXOTGBZPPCQJW66BDXET",
    "paging_token": "261832489243934720",
    "source_account_sequence": "257425187077619861",
    "created_at": "2026-01-27T15:36:13Z"
  }
}
```

---

## 11 | bump_sequence

```json
{
  "operation": {
    "type": "bump_sequence",
    "type_i": 11,
    "bump_to": "151245301938660000",
    "id": "259351587284545537",
    "account": "GDLTH4KKMA4R2JGKA7XKI5DLHJBUT42D5RHVK6SS6YHZZLHVLCWJAYXI"
  },
  "transaction": {
    "hash": "ff5e4dec52d5a8e9a04ec6d004829e069dd4a9709d0e8d2d13b9b726da00e9ec",
    "source": "GDLTH4KKMA4R2JGKA7XKI5DLHJBUT42D5RHVK6SS6YHZZLHVLCWJAYXI",
    "paging_token": "259351587284545536",
    "created_at": "2026-01-..."
  }
}

---

## 12 | manage_buy_offer

```json
{
  "operation": {
    "type_i": 12,
    "type": "manage_sell_offer",
    "asset": {
      "asset_type": 1,
      "asset_code": "EURC",
      "asset_issuer": "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2"
    },
    "amount": "298.2796673",
    "source_asset": {
      "asset_type": 0
    },
    "price": "5.6748001",
    "offerId": "1820872939",
    "id": "261832540782874625",
    "account": "GANNOAJWUBWHMCNMWHZH7WD5SNCCBXDZXCLFWDO7T3D4OOZAVBTAOKN4"
  },
  "transaction": {
    "hash": "abacb5f6034d6c0eaa9b8c311d6728895a5300f546a04cb44ccff4fe1ed584f2",
    "fee": "101",
    "fee_charged": "100",
    "max_fee": "101",
    "source": "GANNOAJWUBWHMCNMWHZH7WD5SNCCBXDZXCLFWDO7T3D4OOZAVBTAOKN4",
    "paging_token": "261832540782874624",
    "source_account_sequence": "168734619223934659",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 13 | path_payment_strict_send

```json
{
  "operation": {
    "type_i": 13,
    "type": "path_payment_strict_send",
    "asset": {
      "asset_type": 0
    },
    "source_asset": {
      "asset_type": 1,
      "asset_code": "USDC",
      "asset_issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    },
    "dest_min": {
      "asset_type": 0
    },
    "path": [],
    "id": "261832540782866433",
    "account": "GCEX3EVHOJ6DOA7VD52G3D4PVI4CRQ4VEOKBMIXCCX7GBP373PIGFW3W",
    "trades": [
      { "type": "order_book", "seller_id": "GDGW6W4ZK5JDHZIN3RAYI3MJVPHFHOGENL3TP2AGX7LO6LIH6CI7PYNF", "offer_id": "1820872937", "asset_sold": { "asset_type": 0 }, "amount_sold": "12395854", "asset_bought": { "asset_type": 1, "asset_code": "USDC", "asset_issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }, "amount_bought": "2535814" },
      { "type": "order_book", "seller_id": "GAUAMW6HXP6NM6FYEMSB3AWIPNJ6OFOVTQTV4FAFDNHBJXV5NHN6HJTV", "offer_id": "1820872949", "asset_sold": { "asset_type": 0 }, "amount_sold": "733230979", "asset_bought": { "asset_type": 1, "asset_code": "USDC", "asset_issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }, "amount_bought": "149999999" }
    ]
  },
  "transaction": {
    "hash": "00c314f688f22cbd9aaecee5f45f313c86e7b010db61c5e41f8771d7cca40a72",
    "fee": "500",
    "fee_charged": "100",
    "max_fee": "500",
    "source": "GCGR7ZPGGJOXYYA4P4ESKEUNRWMIWQRDT3U73JERZAOJS4DYRCEFWL6E",
    "paging_token": "261832540782866432",
    "source_account_sequence": "256172108894225424",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 14 | create_claimable_balance

```json
{
  "operation": {
    "type": "create_claimable_balance",
    "type_i": 14,
    "asset": {
      "asset_type": 2,
      "asset_code": "SILVER",
      "asset_issuer": "GD3LKVLKH3WQSXEETVUDMU2QZFTJG4TPFJQ3SDYKNJHKBEJVOJ6E7Q6X"
    },
    "amount": "0.1000000",
    "claimants": [
      {
        "_destination": "GAELGDUWX23EHWX4EDFGLS4XNUO2WSWHSXMKWMN3DOW5OI5BYTT5CG5Z",
        "_predicate": {
          "_switch": { "name": "claimPredicateBeforeRelativeTime", "value": 5 },
          "_arm": "relBefore",
          "_value": { "_value": "86400" }
        }
      },
      {
        "_destination": "GAF4SOS6CMSY3NETECFSUQMGGZ6TXFEIQ2XPG64AKMWWGUYVNFSL7AFK",
        "_predicate": {
          "_switch": { "name": "claimPredicateUnconditional", "value": 0 }
        }
      }
    ],
    "id": "261832536488128513",
    "account": "GAF4SOS6CMSY3NETECFSUQMGGZ6TXFEIQ2XPG64AKMWWGUYVNFSL7AFK"
  },
  "transaction": {
    "hash": "79922c75cdfad4965efeb1ea4ce75b9ad216ade304df14635891334236b4f425",
    "fee": "10000",
    "fee_charged": "100",
    "max_fee": "10000",
    "source": "GAF4SOS6CMSY3NETECFSUQMGGZ6TXFEIQ2XPG64AKMWWGUYVNFSL7AFK",
    "paging_token": "261832536488128512",
    "source_account_sequence": "261823332372971670",
    "created_at": "2026-01-27T15:37:16Z"
  }
}
```

---

## 15 | claim_claimable_balance

```json
{
  "operation": {
    "type": "claim_claimable_balance",
    "type_i": 15,
    "balanceId": "00000000a24c2270bf84c438ab4daf2b04ec8152d4b81420ae118e6efe42e8c57192d8d8",
    "id": "261832540782972931",
    "account": "GAFI2AOGBCKV7DWK2N77O34RD52C6O6QGGVEV5CEVFQTCHOOI3VOKP7G"
  },
  "transaction": {
    "hash": "bb51541ae52a26ad2ab90036a881e596ae02aa90c1bf17ca4cdfe3dadbea0612",
    "fee": "7000000",
    "fee_charged": "700",
    "max_fee": "7000000",
    "source": "GDN5YRNIP7X4IHGPBAASBWMVUCVKZG4VKSLWRMYDV4MMOCVM3VH6JLCT",
    "paging_token": "261832540782972928",
    "source_account_sequence": "166132650724097100",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 16 | begin_sponsoring_future_reserves

```json
{
  "operation": {
    "type": "begin_sponsoring_future_reserves",
    "type_i": 16,
    "sponsoredId": "GAFI2AOGBCKV7DWK2N77O34RD52C6O6QGGVEV5CEVFQTCHOOI3VOKP7G",
    "id": "261832540782972929",
    "account": "GDB3RSSWTUXO7MBTNMHUP3DRBIUR3QRV2CVFRAKMN4GM2B4QNGEUT6CU"
  },
  "transaction": {
    "hash": "bb51541ae52a26ad2ab90036a881e596ae02aa90c1bf17ca4cdfe3dadbea0612",
    "fee": "7000000",
    "fee_charged": "700",
    "max_fee": "7000000",
    "source": "GDN5YRNIP7X4IHGPBAASBWMVUCVKZG4VKSLWRMYDV4MMOCVM3VH6JLCT",
    "paging_token": "261832540782972928",
    "source_account_sequence": "166132650724097100",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 17 | end_sponsoring_future_reserves

```json
{
  "operation": {
    "type": "end_sponsoring_future_reserves",
    "type_i": 17,
    "id": "261832540782972935",
    "account": "GAFI2AOGBCKV7DWK2N77O34RD52C6O6QGGVEV5CEVFQTCHOOI3VOKP7G"
  },
  "transaction": {
    "hash": "bb51541ae52a26ad2ab90036a881e596ae02aa90c1bf17ca4cdfe3dadbea0612",
    "fee": "7000000",
    "fee_charged": "700",
    "max_fee": "7000000",
    "source": "GDN5YRNIP7X4IHGPBAASBWMVUCVKZG4VKSLWRMYDV4MMOCVM3VH6JLCT",
    "paging_token": "261832540782972928",
    "source_account_sequence": "166132650724097100",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 18 | revoke_sponsorship

*Пример недоступен - редко используемая операция*

---

## 19 | clawback

```json
{
  "operation": {
    "type": "clawback",
    "type_i": 19,
    "from": "GBCX7YM5QNQGV34S7QXZWLP3AA6BGDHYE76FFOKPX2QDF4GRMWTFBWPC",
    "asset": {
      "asset_type": 2,
      "asset_code": "MTLAP",
      "asset_issuer": "GCNVDZIHGX473FEI7IXCUAEXUJ4BGCKEMHF36VYP5EMS7PX2QBLAMTLA"
    },
    "amount": "1.0000000",
    "id": "252382697903824898",
    "account": "GCNVDZIHGX473FEI7IXCUAEXUJ4BGCKEMHF36VYP5EMS7PX2QBLAMTLA"
  },
  "transaction": {
    "hash": "8fcfab1d294692ef45bf0704b98783728591b723c72d4b988a0b8cbb1f6e9ae8",
    "source": "GCNVDZIHGX473FEI7IXCUAEXUJ4BGCKEMHF36VYP5EMS7PX2QBLAMTLA",
    "paging_token": "252382697903824896",
    "created_at": "2025-09-12T..."
  }
}

---

## 20 | clawback_claimable_balance

```json
{
  "operation": {
    "type": "clawback_claimable_balance",
    "type_i": 20,
    "balanceId": "0000000064431c86e52d7db7a1a89e9db45941f835747208aaeedd4172d8079db6d5396e",
    "id": "210611473775775745",
    "account": "GAXSGZ2JM3LNWOO4WRGADISNMWO4HQLG4QBGUZRKH5ZHL3EQBGX73ICE"
  },
  "transaction": {
    "hash": "bbfd7d492d2c865e84959e040f3b213c127c4c76f74eaa76fac0796c0db042c0",
    "source": "GAXSGZ2JM3LNWOO4WRGADISNMWO4HQLG4QBGUZRKH5ZHL3EQBGX73ICE",
    "paging_token": "210611473775775744",
    "created_at": "2023-10-27T..."
  }
}

---

## 21 | set_trustline_flags

```json
{
  "operation": {
    "type": "set_trustline_flags",
    "type_i": 21,
    "trustor": "GABOGH3GWUCEJ2ZGS4CFX2ANBQMLLGJZVZW7HUFO6UJP5E2ICW37KBDD",
    "asset": {
      "asset_type": 1,
      "asset_code": "SLVR",
      "asset_issuer": "GATY5E2ZE2IJS3FM52B4TIA6TLE7GN6TDAJGHWIRETSNNWJII5LS4E6N"
    },
    "id": "261832356100812804",
    "account": "GATY5E2ZE2IJS3FM52B4TIA6TLE7GN6TDAJGHWIRETSNNWJII5LS4E6N"
  },
  "transaction": {
    "hash": "14687fdbd81a405c770c73e6f0e706bce27c2aeed17d570e19d6f9676a068bfa",
    "fee": "1900",
    "fee_charged": "2000",
    "max_fee": "20000000",
    "source": "GDIT5GHDFUJYDCCYMO6TV6VM5QXR36XNZPEDI7CURMQZ7EQBJI46SZWP",
    "paging_token": "261832356100812800",
    "source_account_sequence": "157404181961912111",
    "created_at": "2026-01-27T15:33:12Z"
  }
}
```

---

## 22 | liquidity_pool_deposit

```json
{
  "operation": {
    "type": "liquidity_pool_deposit",
    "type_i": 22,
    "liquidityPoolId": "3fdb3afae74f0db26bd1b8cbf292743df687dde6d037cbf4790cba37dc63a110",
    "maxAmountA": "0.2741707",
    "maxAmountB": "10.0000000",
    "minPrice": "0.02714289930000000005",
    "maxPrice": "0.02769124069999999988",
    "id": "261832523603750913",
    "account": "GD75PZMUQ6BJKUISFMKLJLJ2QYPPRORRTZQCAWYUO77RPHECLEDVSOTX"
  },
  "transaction": {
    "hash": "6c9693bf34e744633ee376fefee77e70450e6dbbcb0e243043c2915a50ce04ae",
    "fee": "100000",
    "fee_charged": "100",
    "max_fee": "100000",
    "source": "GD75PZMUQ6BJKUISFMKLJLJ2QYPPRORRTZQCAWYUO77RPHECLEDVSOTX",
    "paging_token": "261832523603750912",
    "source_account_sequence": "168283282583065771",
    "created_at": "2026-01-27T15:36:59Z"
  }
}
```

---

## 23 | liquidity_pool_withdraw

```json
{
  "operation": {
    "type": "liquidity_pool_withdraw",
    "type_i": 23,
    "liquidityPoolId": "26c0eb1f41b00c82ba2dc0f4f8c16396fa1d3f58629b0c2fb0b0121635968e77",
    "amount": "10000.0000000",
    "minAmountA": "10575.0561950",
    "minAmountB": "9014.7734691",
    "id": "257886075723632641",
    "account": "GB2ZUCM6YWQET4HHLJKMQP7FGUES4TF32VCUYHVNICGNVISAXBSARGUN"
  },
  "transaction": {
    "hash": "0d2c5c9dad8c1f215206dfb55fc7eec279b1c5037734c4cca5f56d2c442a17ce",
    "fee": "10101",
    "fee_charged": "100",
    "max_fee": "10101",
    "source": "GB2ZUCM6YWQET4HHLJKMQP7FGUES4TF32VCUYHVNICGNVISAXBSARGUN",
    "paging_token": "257886075723632640",
    "source_account_sequence": "197738159709094078",
    "created_at": "2025-11-27T16:59:03Z"
  }
}
```

---

## 24 | invoke_host_function

```json
{
  "operation": {
    "type": "invoke_host_function",
    "type_i": 24,
    "id": "261832540783890433",
    "account": "GDRI3GQG6AK3NKSVJSUGQOYWEUDIGEZCGM3JS2Q7UCFNNMHBL52Q25NC"
  },
  "transaction": {
    "hash": "8cc6f340047080a73b1da694e1c7875e39a11ab54b0e0ab41367a7ca767246ec",
    "fee": "144780",
    "fee_charged": "103058",
    "max_fee": "144881",
    "source": "GDRI3GQG6AK3NKSVJSUGQOYWEUDIGEZCGM3JS2Q7UCFNNMHBL52Q25NC",
    "paging_token": "261832540783890432",
    "source_account_sequence": "259186630475169261",
    "created_at": "2026-01-27T15:37:22Z"
  }
}
```

---

## 25 | extend_footprint_ttl

*Пример недоступен - Soroban операция*

---

## 26 | restore_footprint

*Пример недоступен - Soroban операция*

---

## Примечания

- `asset_type`: 0 = native (XLM), 1 = credit_alphanum4, 2 = credit_alphanum12
- `memo.value` может быть строкой или Buffer (для бинарных данных)
- `trades` присутствует только в path_payment операциях и содержит информацию об исполненных сделках
- Deprecated операции (7, 9) больше не используются в сети
