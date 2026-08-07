import json
import re
import time
from openai import OpenAI

# 1. ჩასვი შენი API Key
client = OpenAI(api_key="")

# 2. ვკითხულობთ არსებულ codes.js-ს, რომ დუბლიკატები გამოვტოვოთ
existing_codes = set()
try:
    with open('dist/js/codes.js', 'r', encoding='utf-8') as f:
        content = f.read()
        existing_codes = set(re.findall(r"'([PBCU]\d{4})'", content))
        print(f"✅ codes.js-ში ნაპოვნია {len(existing_codes)} არსებული კოდი. ესენი გამოიტოვება.")
except Exception as e:
    print(f"⚠️ codes.js-ის წაკითხვის შეცდომა: {e}")

# 3. ვხსნით ინგლისურ JSON ფაილს
with open('obd2_codes_english.json', 'r', encoding='utf-8') as f:
    raw_data = json.load(f)

# კოდების პაკეტური (Batch) თარგმნის ფუნქცია
def translate_batch(batch_items):
    prompt = f"""
    შენ ხარ პროფესიონალი ავტო-ინჟინერი Octane App-ისთვის.
    გადათარგმნე OBD2 კოდების ეს სია ინგლისურიდან გამართულ, ბუნებრივ ქართულ ენაზე.

    კოდების სია:
    {json.dumps(batch_items, ensure_ascii=False, indent=2)}

    წესები:
    1. გამოიყენე გამართული ქართული ენის გრამატიკა (არასოდეს თარგმნო სიტყვასიტყვით).
    2. გამოიყენე ქართულ ავტო-სამყაროში დამკვიდრებული ტერმინები ("წრედი", "მოკლე ჩართვა მასაზე/კვებაზე", "ჰაერის გაპარვა", "აალების გამოტოვება", "ძრავის ტროენი", "ნარევის გაღარიბება/გამდიდარება").
    3. "level"-ისთვის აირჩიე ზუსტად 1 ამ ოთხიდან: 'კრიტიკული', 'ყურადღება', 'სერვისში მისასვლელი', 'ინფორმაციული'.

    დააბრუნე JSON ობიექტი, სადაც Key იქნება OBD2 კოდი (მაგ: P1101), ხოლო Value იქნება ობიექტი 4 ველით: title, level, desc, symptoms.
    """
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"❌ Error during batch processing: {e}")
        return None

# 4. ვამზადებთ მხოლოდ ახალ კოდებს
new_items_to_translate = {}

if isinstance(raw_data, list):
    for entry in raw_data:
        if isinstance(entry, dict):
            for raw_code, desc in entry.items():
                code = str(desc).strip() if str(raw_code).startswith('P0100') and not str(desc).startswith('P0100') else str(raw_code).strip()
                
                if not re.match(r'^[PBCU]\d{4}$', code):
                    match = re.search(r'([PBCU]\d{4})', str(entry))
                    if match:
                        code = match.group(1)

                if re.match(r'^[PBCU]\d{4}$', code) and code not in existing_codes:
                    new_items_to_translate[code] = desc

print(f"📦 სულ სათარგმნია {len(new_items_to_translate)} ახალი კოდი.")

# 5. ვხსნით გამომავალ ფაილს
js_file = open('new_generated_codes.js', 'w', encoding='utf-8')
js_file.write("// სწრაფად და გამართულად გენერირებული კოდები Octane App-ისთვის\n")
js_file.write("window.OBD_CODES = window.OBD_CODES || {};\n\n")

BATCH_SIZE = 25  # 25 კოდს ვგზავნით ერთდროულად
codes_keys = list(new_items_to_translate.keys())
total_translated = 0

print("🚀 იწყება აჩქარებული (Batch) თარგმნა...")

for i in range(0, len(codes_keys), BATCH_SIZE):
    batch_keys = codes_keys[i:i + BATCH_SIZE]
    batch_data = {k: new_items_to_translate[k] for k in batch_keys}
    
    print(f"⚡ ითარგმნება პაკეტი ({i + 1} - {min(i + BATCH_SIZE, len(codes_keys))}) / {len(codes_keys)}...")
    
    result = translate_batch(batch_data)
    
    if result:
        # თუ AI-მ პასუხი ჩაალაგა რაიმე შიდა key-ში (მაგ. "codes")
        translated_dict = result.get("codes", result) if "codes" in result and len(result) == 1 else result
        
        js_file.write("Object.assign(window.OBD_CODES, ")
        js_file.write(json.dumps(translated_dict, ensure_ascii=False, indent=2))
        js_file.write(");\n\n")
        js_file.flush()
        
        total_translated += len(translated_dict)
        print(f"✅ წარმატებით ჩაიწერა {len(translated_dict)} კოდი.")
    
    time.sleep(0.1)

js_file.close()
print(f"🎉 დასრულდა! სულ სწრაფად გენერირდა {total_translated} კოდი.")