/**
 * クーポン情報
 */
class CouponInfo {
    /** @type {string} */
    code;
    /** @type {number} */
    price;
    /** @type {number} */
    count;

    /**
     * コンストラクタ
     * @param {string} code クーポンコード
     * @param {number} price 割引後価格
     * @param {number} count 枚数
     */
    constructor(code, price, count) {
        this.code = code;
        this.price = price;
        this.count = count;
    }
}

document.getElementById("button-run").addEventListener("click", async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const ticketName = document.getElementById("ticket-name-input").value;
        if (!ticketName) {
            alert("チケット名を入力してください。");
            return;
        }
        const couponInput = document.getElementById("coupon-input").value;
        if (!couponInput) {
            alert("クーポン情報を入力してください。")
            return;
        }
        const couponInfos = readCouponInfos(couponInput);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: onRun,
          args: [ticketName, couponInfos]
        });
    } catch (e) {
        if (e instanceof Error) {
            alert(`エラー:\n${e.message}\n\n${e.stack}`);
        }
    }
});

/**
 * クーポン情報を読み取る
 * @param {string} input
 * @returns {CouponInfo[]}
 */
function readCouponInfos(input) {
    const isValidInt = (str) => {
        const number = Number(str);
        return Number.isInteger(number) && number >= 0;
    }

    /** @type {CouponInfo[]} */
    const couponInfos = [];
    input.split(/\r?\n/).forEach((line, index, arr) => {
        const [code, price, count] = line.split(",").map(x => x.trim());
        if (code && price && count && isValidInt(price) && isValidInt(count)) {
            couponInfos.push(new CouponInfo(code, Number(price), Number(count)))
        } else if (line === "" && index === arr.length - 1) {
            // 最終行の改行なので許す
        }
        else {
            throw new Error(`不正なクーポン情報があります。${index+1}行目: ${line ? line : "空欄"}`);
        }
    });

    return couponInfos;
}

/**
 * フィル実行
 * @param {string} ticketName チケット名
 * @param {CouponInfo[]} couponInfos クーポン情報の配列
 */
async function onRun(ticketName, couponInfos) {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        //
        // 全チケット情報から登録対象を探す
        //
        const ticketAreas = document.querySelectorAll("#control-panel .lists li");
        let targetTicketArea = null;
        for (const area of ticketAreas) {
            if (area.querySelector(".ticket-form__ticket-name input").value === ticketName) {
                targetTicketArea = area;
                break;
            }
        }
        if (!targetTicketArea) {
            throw new Error("入力されたチケット名に一致するチケットが見つかりません。");
        }

        if (!targetTicketArea.querySelector(".ticket-form__detail-manage")) {
            // 詳細設定が開かれていないので開いておく
            for (const button of targetTicketArea.querySelectorAll("button")) {
                if (button.textContent === "詳細設定") {
                    button.click();
                    await sleep(500);
                    break;
                }
            }
        }

        //
        // 登録済みのクーポンを取得
        //
        /** @type {Set<string>} */
        const seenCoupons = new Set();
        for (const input of targetTicketArea.querySelectorAll(".detail-upper__code > input")) {
            const code = input.value;
            if (code) {
                seenCoupons.add(code);
            }
        };

        //
        // クーポンを登録
        // タイミングの問題で入力に失敗するのを避けるため、まずクーポンコード分の入力欄を作ってから埋める
        //

        // 登録を開始するクーポンリストのインデックス 未登録なら 0
        const startIndex = [...targetTicketArea.querySelectorAll(".ticket-coupon__list > .coupon-item")].length;

        /** @type {CouponInfo[]} */
        const validCouponInfos = [];
        /** @type {CouponInfo[]} */
        const invalidCouponInfos = [];
        for (const couponInfo of couponInfos) {
            // 登録済みなのでスキップ
            if (seenCoupons.has(couponInfo.code)) {
                invalidCouponInfos.push(couponInfo);
                continue;
            }

            // 入力エリアを用意
            if (startIndex === 0 && couponInfo === couponInfos[0]) {
                // 未登録なので「設定する」をクリック
                targetTicketArea.querySelector('.ticket-coupon__none > button').click();
            } else {
                // 「追加」をクリック
                let found = false;
                for (const button of targetTicketArea.querySelectorAll('button')) {
                    if (button.textContent === "追加") {
                        found = true;
                        button.click();
                        break;
                    }
                }
                if (!found) {
                    // 通常起こらない
                    throw new Error("追加ボタンが見つかりませんでした。");
                }
            }

            validCouponInfos.push(couponInfo);
            seenCoupons.add(couponInfo.code);

            await sleep(200);
        }

        await sleep(500);

        // 入力
        const items = [...targetTicketArea.querySelectorAll(".ticket-coupon__list > .coupon-item")]
        if (items.length !== startIndex + validCouponInfos.length) {
            // 追加に失敗した？
            throw new Error("入力欄とコードの数が一致しません。ページをリロードしてやり直してください。");
        }

        for (let i = startIndex; i < items.length; i++) {
            const couponInfo = validCouponInfos.shift();
            const newItem = items[i];
            const codeInput = newItem.querySelector(".detail-upper__code > input");
            const priceInput = newItem.querySelector(".detail-upper__price > input");
            const countInput = newItem.querySelector(".detail-upper__limit-num > input");
            codeInput.value = couponInfo.code;
            priceInput.value = couponInfo.price.toString();
            countInput.value = couponInfo.count.toString();
        }

        if (invalidCouponInfos.size > 0) {
            const skippedCouponText = invalidCouponInfos.map(x => `${x.code},${x.price},${x.count}`);
            alert(`登録されなかったクーポン:\n${skippedCouponText.join("\n")}`);
        }

        await sleep(500);

        alert("処理が完了しました。入力内容を必ず目視で確認してから保存してください。");
    } catch (e) {
        if (e instanceof Error) {
            alert(`エラー:\n${e.message}`);
            console.error(e.stack);
        } else {
            console.error(e.toString());
        }
    }
}

document.getElementById("help-link-url").addEventListener("click", async () => {
    chrome.tabs.create({ url: "https://help.teket.jp/hc/ja/articles/900000512563" });
});