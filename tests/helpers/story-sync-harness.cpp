// Host harness for tests/story-sync-core.test.ts. Reads one command per line
// from stdin and prints one result per line:
//   bundle <name> | file <name> | crc <hex> | size <n> | baseurl <url>
//       -> 1 or 0
//   parseurl <url>              -> "<a.b.c.d> <port> <path>" or 0
//   request <url> <name>        -> the GET request, percent-encoded, or 0
//   head <bytes>                -> "more", "done <status>" or "error <reason>"
//   deadline <size>             -> the file's deadline in ms
//   evict <need> <free> <current> <name>:<bytes>,...
//       -> 1 or 0 (fits or not), then the chosen victims: "1 b,a", "1", "0"
// Arguments are percent-encoded (%0D for a carriage return, %25 for '%'), so a
// test can send any byte. An empty argument is written as "-".
#include "../../device/lib/drivers/src/StorySyncCore.h"

#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

using namespace StorySyncCore;

static std::string decode(const std::string& s) {
  if (s == "-") return "";
  std::string out;
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == '%' && i + 2 < s.size()) {
      out += static_cast<char>(std::strtol(s.substr(i + 1, 2).c_str(), nullptr, 16));
      i += 2;
    } else {
      out += s[i];
    }
  }
  return out;
}

static std::string encode(const std::string& s) {
  std::string out;
  char hex[4];
  for (unsigned char c : s) {
    if (c < 0x20 || c == '%' || c == 0x7f) {
      std::snprintf(hex, sizeof(hex), "%%%02X", c);
      out += hex;
    } else {
      out += static_cast<char>(c);
    }
  }
  return out;
}

static std::vector<std::string> words(const std::string& s) {
  std::vector<std::string> out;
  std::istringstream in(s);
  for (std::string w; in >> w;) out.push_back(decode(w));
  return out;
}

static std::string evict(const std::vector<std::string>& w) {
  if (w.size() < 3) return "bad";
  // Names first, so the entries can point at strings that no longer move.
  std::vector<std::string> names;
  std::vector<uint64_t> sizes;
  std::istringstream list(w.size() > 3 ? w[3] : "");
  for (std::string item; std::getline(list, item, ',');) {
    const size_t colon = item.rfind(':');
    names.push_back(item.substr(0, colon));
    sizes.push_back(std::strtoull(item.substr(colon + 1).c_str(), nullptr, 10));
  }
  std::vector<EvictionEntry> entries;
  for (size_t i = 0; i < names.size(); i++) entries.push_back({names[i].c_str(), sizes[i]});
  std::unique_ptr<bool[]> chosen(new bool[entries.size() + 1]());
  const bool fits = planEviction(std::strtoull(w[0].c_str(), nullptr, 10),
                                 std::strtoull(w[1].c_str(), nullptr, 10), entries.data(),
                                 entries.size(), w[2].c_str(), chosen.get());
  std::string out = fits ? "1" : "0";
  const char* sep = " ";
  for (size_t i = 0; i < entries.size(); i++) {
    if (!chosen[i]) continue;
    out += sep;
    out += entries[i].name;
    sep = ",";
  }
  return out;
}

int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    const size_t sp = line.find(' ');
    const std::string cmd = line.substr(0, sp);
    const std::string rest = sp == std::string::npos ? "" : line.substr(sp + 1);
    const std::string whole = decode(rest);
    if (cmd == "bundle") {
      std::cout << validBundleName(whole.c_str());
    } else if (cmd == "file") {
      std::cout << validFileName(whole.c_str());
    } else if (cmd == "crc") {
      std::cout << validCrcHex(whole.c_str());
    } else if (cmd == "size") {
      std::cout << validSize(std::strtoll(whole.c_str(), nullptr, 10));
    } else if (cmd == "baseurl") {
      std::cout << validBaseUrl(whole.c_str());
    } else if (cmd == "parseurl") {
      BaseUrl u;
      if (parseBaseUrl(whole.c_str(), &u)) {
        std::cout << int(u.ip[0]) << "." << int(u.ip[1]) << "." << int(u.ip[2]) << "."
                  << int(u.ip[3]) << " " << u.port << " " << u.path;
      } else {
        std::cout << 0;
      }
    } else if (cmd == "request") {
      const std::vector<std::string> w = words(rest);
      BaseUrl u;
      char req[kMaxRequestLen];
      if (w.size() == 2 && parseBaseUrl(w[0].c_str(), &u) &&
          formatGetRequest(u, w[1].c_str(), req, sizeof(req))) {
        std::cout << encode(req);
      } else {
        std::cout << 0;
      }
    } else if (cmd == "head") {
      ResponseHead head;
      ResponseHead::Step step = ResponseHead::Step::More;
      for (char c : whole) {
        step = head.feed(c);
        if (step != ResponseHead::Step::More) break;
      }
      if (step == ResponseHead::Step::Done) {
        std::cout << "done " << head.status();
      } else if (step == ResponseHead::Step::Error) {
        std::cout << "error " << head.error();
      } else {
        std::cout << "more";
      }
    } else if (cmd == "deadline") {
      std::cout << fileDeadlineMs(std::strtoul(whole.c_str(), nullptr, 10));
    } else if (cmd == "evict") {
      std::cout << evict(words(rest));
    } else {
      std::cout << "unknown " << cmd;
    }
    std::cout << "\n";
    std::cout.flush();
  }
  return 0;
}
