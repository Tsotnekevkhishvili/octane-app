package ge.octane.app;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Octane App — ლოკალური „შუამავალი“ კამერის ფაილებისთვის.
 *
 * WebView (<img>, <video>) კამერის WiFi-ს (ინტერნეტის გარეშე ქსელს) ყველა ტელეფონზე ვერ წვდება,
 * ნატიური კავშირი კი (camNetwork.openConnection) წვდება. ამიტომ WebView ითხოვს
 *   http://127.0.0.1:PORT/http/192.168.0.1/sd/norm/X.MP4
 * და აქედან მოთხოვნა კამერას გადაეცემა ნატიურად - Range-ის მხარდაჭერით (ვიდეოს გადახვევა).
 */
public class DashcamProxy {

    public interface Opener { HttpURLConnection open(String url, int timeoutMs) throws Exception; }

    private final Opener opener;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket server;

    public DashcamProxy(Opener opener) { this.opener = opener; }

    public synchronized int start() {
        if (server != null && !server.isClosed()) return server.getLocalPort();
        try {
            server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            final ServerSocket s = server;
            pool.execute(() -> {
                while (!s.isClosed()) {
                    try {
                        final Socket client = s.accept();
                        pool.execute(() -> handle(client));
                    } catch (Exception e) {
                        if (s.isClosed()) break;
                    }
                }
            });
            return server.getLocalPort();
        } catch (Exception e) {
            return 0;
        }
    }

    public synchronized void stop() {
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        server = null;
        pool.shutdownNow();
    }

    private static String readLine(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) break;
        }
        return sb.toString();
    }

    private void handle(Socket client) {
        HttpURLConnection c = null;
        try {
            client.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(client.getInputStream());
            OutputStream out = client.getOutputStream();
            String first = readLine(in);
            String range = null;
            String line;
            while (!(line = readLine(in)).isEmpty()) {
                int i = line.indexOf(':');
                if (i > 0 && line.substring(0, i).trim().equalsIgnoreCase("Range")) range = line.substring(i + 1).trim();
            }
            String[] parts = first.split(" ");
            if (parts.length < 2 || !parts[1].startsWith("/http/")) { simple(out, 404); return; }
            boolean head = "HEAD".equalsIgnoreCase(parts[0]);
            String target = "http://" + URLDecoder.decode(parts[1].substring(6), "UTF-8").replace(" ", "%20");

            c = opener.open(target, 15000);
            if (range != null) c.setRequestProperty("Range", range);
            int status = c.getResponseCode();
            StringBuilder h = new StringBuilder();
            h.append("HTTP/1.1 ").append(status).append(status == 206 ? " Partial Content" : status < 400 ? " OK" : " Error").append("\r\n");
            String type = c.getContentType();
            if (type == null || type.isEmpty() || type.startsWith("text/plain")) type = guessType(target);
            h.append("Content-Type: ").append(type).append("\r\n");
            long len = c.getContentLengthLong();
            if (len >= 0) h.append("Content-Length: ").append(len).append("\r\n");
            String cr = c.getHeaderField("Content-Range");
            if (cr != null) h.append("Content-Range: ").append(cr).append("\r\n");
            String ar = c.getHeaderField("Accept-Ranges");
            if (ar != null) h.append("Accept-Ranges: ").append(ar).append("\r\n");
            h.append("Access-Control-Allow-Origin: *\r\nCache-Control: max-age=3600\r\nConnection: close\r\n\r\n");
            out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (!head) {
                InputStream body = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (body != null) {
                    byte[] b = new byte[64 * 1024];
                    int n;
                    while ((n = body.read(b)) > 0) out.write(b, 0, n);
                    body.close();
                }
            }
            out.flush();
        } catch (Exception ignored) {
            // WebView ხშირად თავად წყვეტს კავშირს (გადახვევა, ფანჯრის დახურვა) - ეს ნორმალურია
        } finally {
            if (c != null) c.disconnect();
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    private static void simple(OutputStream out, int status) throws Exception {
        out.write(("HTTP/1.1 " + status + " Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private static String guessType(String url) {
        String u = url.toLowerCase();
        if (u.endsWith(".mp4") || u.endsWith(".mov")) return "video/mp4";
        if (u.endsWith(".ts")) return "video/mp2t";
        if (u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".thm")) return "image/jpeg";
        return "application/octet-stream";
    }
}
