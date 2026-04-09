import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { resolveUrl } from "../utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.resolve(__filename, ".."));

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    try {
        // Navigate to the Facebook WhatsApp pricing page
        console.log("Navigating to the page...");
        await page.goto(
            "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
            {
                waitUntil: "networkidle2",
            }
        );

        console.log("Page loaded. Searching for the element...");

        // Execute script in the browser context to find and log the element
        const result = await page.evaluate(() => {
            const html = document.querySelectorAll('.x1i10hfl.x1qjc9v5.xjbqb8w.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xdl72j9.xdt5ytf.x2lah0s.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.x2lwn1j.xeuugli.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1n2onr6.x16tdsg8.xggy1nq.x1ja2u2z.x1t137rt.xt0psk2.x1hl2dhg.x1lku1pv.x1xlr1w8.xawggmj');

            const elements = [];

            for (const element of html) {
                if (element.innerText.includes("USD rates")) {
                    elements.push(element.outerHTML);
                }
                if (element.innerText.includes("USD volume tiers")) {
                    elements.push(element.outerHTML);
                }
            }

            return elements;
        });

        if (result) {
            console.log("Found element with 'USD rates and volume tiers':");

            const rates = cheerio.load(result[0]);
            const ratesHref = resolveUrl(rates("a").attr("href"));

            const volumeTiers = cheerio.load(result[1]);
            const volumeTiersHref = resolveUrl(volumeTiers("a").attr("href"));

            // download the files and save them to the local file system
            const ratesResponse = await axios.get(ratesHref, {
                responseType: "arraybuffer",
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "text/csv,*/*",
                },
            });
            const volumeTiersResponse = await axios.get(volumeTiersHref, {
                responseType: "arraybuffer",
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "text/csv,*/*",
                },
            });

            const filesPath = path.join(__dirname, "public");

            const ratesFilePath = path.join(
                filesPath,
                "USD_rates.csv"
            );
            const volumeTiersFilePath = path.join(
                filesPath,
                "USD_volume_tiers.csv"
            );

            fs.writeFileSync(ratesFilePath, ratesResponse.data);
            fs.writeFileSync(volumeTiersFilePath, volumeTiersResponse.data);

            console.log("Files downloaded and saved successfully.");

        } else {
            console.log(
                "Element with 'USD rates and volume tiers' not found on the page."
            );
        }
    } catch (error) {
        console.error("Error:", error);
    } finally {
        await browser.close();
    }
})();
