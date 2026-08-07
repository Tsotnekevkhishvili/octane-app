export default async function handler(req, res) {
    // 1. CORS Headers - ნებას რთავს ნებისმიერ origin-ს (localhost-საც და production-საც)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // 2. Preflight request-ის დამუშავება
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const { code, title } = req.body || {};
        const apiKey = "";

        const prompt = `შენ ხარ გამოცდილი ავტომექანიკოსი. დეტალურად, რამდენიმე აბზაცად ქართულად აუხსენი მომხმარებელს OBD2 ხარვეზის კოდი ${code} (${title}). 
დაწერე სტრუქტურირებულად:
1. რა არის პრობლემა და რას ნიშნავს ეს კოდი.
2. რა სიმპტომები შეიძლება ჰქონდეს მანქანას.
3. რა არის სავარაუდო მიზეზები.
4. როგორ მოაგვაროს ნაბიჯ-ნაბიჯ.`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "შენ ხარ პროფესიონალი ავტომექანიკოსი და OBD2 დიაგნოსტიკის ექსპერტი." },
                    { role: "user", content: prompt }
                ]
            })
        });

        const data = await response.json();

        if (response.ok && data.choices && data.choices[0].message.content) {
            return res.status(200).json({ text: data.choices[0].message.content });
        } else {
            return res.status(500).json({ error: data.error?.message || "Groq Error" });
        }
    } catch (error) {
        return res.status(500).json({ error: "Server Exception: " + error.message });
    }
}