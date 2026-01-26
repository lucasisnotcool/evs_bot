/**
 * Minimal Telegram bot for EVS meter info / balance / usage.
 * Store bot token in Script Properties: TELEGRAM_BOT_TOKEN
 */

var EVS = {
  authBase: "https://evs2u.evs.com.sg",
  oreBase: "https://ore.evs.com.sg"
};

var DEBUG = true;

var TELEGRAM = {
  apiBase: "https://api.telegram.org/bot"
};

function okResponse_() {
  // Some webhook senders behave better when GAS returns an HtmlService response.
  // Keep payload minimal.
  return HtmlService.createHtmlOutput("ok");
}

function doPost(e) {
  var raw = e && e.postData ? e.postData.contents : "";
  var update = safeJsonParse_(raw);
  var updateId = update && update.update_id != null ? Number(update.update_id) : null;
  logEvent_("update_received", {
    update_id: updateId,
    raw_len: raw ? String(raw).length : 0,
    keys: update ? Object.keys(update) : []
  });
  if (updateId != null && !shouldProcessUpdateId_(updateId)) {
    logEvent_("duplicate_update", { update_id: updateId });
    return okResponse_();
  }

  var processedOk = false;
  try {
    if (!update) {
      processedOk = true;
      return okResponse_();
    }

    if (update.callback_query) {
      logEvent_("incoming", { update_id: update.update_id, type: "callback_query", raw: raw });
      logUpdateSummary_(update);
      handleCallback_(update.callback_query);
      processedOk = true;
      return okResponse_();
    }

    var message = update.message || update.edited_message || null;
    if (!message || !message.chat) {
      logEvent_("incoming_other", { update_id: update.update_id, keys: Object.keys(update || {}) });
      processedOk = true;
      return okResponse_();
    }

    var chatId = String(message.chat.id);
    var text = normalizeText_(message.text || "");
    var msgType = update.edited_message ? "edited_message" : "message";
    logEvent_("incoming", { update_id: update.update_id, type: msgType, raw: raw });
    logUpdateSummary_(update);
    logEvent_("message", { chat_id: chatId, text: text, from: message.from || {} });

    var user = getUser_(chatId);
    if (message && message.from) {
      upsertTelegramUser_(chatId, message.from);
      user = getUser_(chatId);
    }
    if (message.chat && message.chat.type === "private") {
      setMyCommandsForChat_(chatId, user);
    }
    var parsed = parseCommand_(text);

    if (parsed.command === "/start") {
      setMyCommandsForChat_(chatId, user);
      sendHtmlMessage_(chatId, buildWelcomeMessage_());
      processedOk = true;
      return okResponse_();
    }

    if (parsed.command === "/help") {
      sendMessage_(chatId, buildHelpMessage_());
      processedOk = true;
      return okResponse_();
    }

    if (parsed.command === "/login") {
      if (parsed.args.length >= 2) {
        var username = parsed.args[0];
        var password = parsed.args.slice(1).join(" ");
        setUser_(chatId, {
          username: username,
          password: password,
          state: ""
        });
        sendMessage_(chatId, "Logging in and fetching your meter data...");
        var statusRes = handleStatus_(chatId, getUser_(chatId), { suppressErrors: true });
        if (statusRes.ok) {
          setMyCommandsForChat_(chatId, getUser_(chatId));
        } else {
          sendMessage_(chatId, loginFailureMessage_(statusRes.error));
        }
        processedOk = true;
        return okResponse_();
      }
      setUser_(chatId, { state: "await_username" });
      sendMessage_(chatId, "Please enter your EVS username.");
      processedOk = true;
      return okResponse_();
    }

    if (parsed.command === "/logout") {
      setUser_(chatId, {
        username: "",
        password: "",
        state: "",
        meter_displayname: "",
        meter_sn: ""
      });
      setMyCommandsForChat_(chatId, null);
      sendMessage_(chatId, "Logged out. Your EVS account has been unlinked.");
      processedOk = true;
      return okResponse_();
    }

    if (parsed.command === "/status" || parsed.command === "/balance" || parsed.command === "/usage" || parsed.command === "/myinfo" || parsed.command === "/history" || parsed.command === "/upgrade" || parsed.command === "/notify" || parsed.command === "/leaderboard" || parsed.command === "/data" || parsed.command === "/join_waitlist" || parsed.command === "/leave_waitlist") {
      if (parsed.command === "/upgrade") {
        handleUpgrade_(chatId, parsed.args);
        processedOk = true;
        return okResponse_();
      }
      if (parsed.command === "/join_waitlist") {
        handleWaitlistJoin_(chatId);
        processedOk = true;
        return okResponse_();
      }
      if (parsed.command === "/leave_waitlist") {
        handleWaitlistLeave_(chatId);
        processedOk = true;
        return okResponse_();
      }
      if (!user || !user.username || !user.password) {
        setUser_(chatId, { state: "await_username" });
        sendMessage_(chatId, "Please login first. Send /login <username> <password>.");
        processedOk = true;
        return okResponse_();
      }
      if (parsed.command === "/balance" || parsed.command === "/usage") {
        handleStatus_(chatId, user);
      } else if (parsed.command === "/myinfo") {
        handleMyInfo_(chatId, user);
      } else if (parsed.command === "/history") {
        handleHistory_(chatId, user, parsed.args);
      } else if (parsed.command === "/notify") {
        handleNotify_(chatId, user, parsed.args);
      } else if (parsed.command === "/leaderboard") {
        handleLeaderboard_(chatId, user, parsed.args);
      } else if (parsed.command === "/data") {
        handleData_(chatId, user, parsed.args);
      } else {
        handleStatus_(chatId, user);
      }
      processedOk = true;
      return okResponse_();
    }

    if (user && user.state === "await_username") {
      setUser_(chatId, {
        username: text,
        state: "await_password"
      });
      sendMessage_(chatId, "Got it. Please enter your EVS password.");
      processedOk = true;
      return okResponse_();
    }

    if (user && user.state === "await_password") {
      setUser_(chatId, {
        password: text,
        state: ""
      });
      sendMessage_(chatId, "Logging in and fetching your meter data...");
      var statusRes2 = handleStatus_(chatId, getUser_(chatId), { suppressErrors: true });
      if (statusRes2.ok) {
        setMyCommandsForChat_(chatId, getUser_(chatId));
      } else {
        sendMessage_(chatId, loginFailureMessage_(statusRes2.error));
      }
      processedOk = true;
      return okResponse_();
    }

    sendMessage_(chatId, "Unknown command. Use /start, /help, /login, /status, /myinfo, /history, /leaderboard, /data, /upgrade, /notify, /join_waitlist, /leave_waitlist, /logout.");
    processedOk = true;
    return okResponse_();
  } finally {
    if (updateId != null && !processedOk) {
      logEvent_("update_not_processed", { update_id: updateId });
    }
    if (updateId != null && processedOk) {
      markUpdateProcessed_(updateId);
    }
  }
}

function doGet() {
  return okResponse_();
}

function entryPoint() {
  if (!DEBUG) return;
  log_("entryPoint", { when: new Date().toISOString() });

  var props = PropertiesService.getScriptProperties().getProperties();
  log_("scriptProperties", { keys: Object.keys(props) });

  var token = props.TELEGRAM_BOT_TOKEN || "";
  log_("telegramToken", { present: !!token, length: token.length, prefix: token.slice(0, 6) });

  try {
    log_("webhookInfo", getWebhookInfo());
  } catch (err) {
    log_("webhookInfoError", String(err));
  }

  try {
    log_("telegramGetMe", telegramGetMe());
  } catch (errMe) {
    log_("telegramGetMeError", String(errMe));
  }

  try {
    var autoHook = props.TELEGRAM_AUTO_WEBHOOK === "true";
    if (autoHook) {
      var setRes = setWebhookAuto();
      log_("setWebhook", setRes);
    } else {
      log_("setWebhook", { skipped: true });
    }
  } catch (errSet) {
    log_("setWebhookError", String(errSet));
  }

  try {
    var cmdRes = setMyCommandsDefault_();
    log_("setMyCommands", cmdRes);
  } catch (errCmd) {
    log_("setMyCommandsError", String(errCmd));
  }

  try {
    getUsersSheet_();
    log_("sheetUsers", { ok: true });
  } catch (eUsers) {
    log_("sheetUsersError", String(eUsers));
  }
  try {
    getLogsSheet_();
    log_("sheetLogs", { ok: true });
  } catch (eLogs) {
    log_("sheetLogsError", String(eLogs));
  }
  try {
    getAccountBalancesSheet_();
    log_("sheetAccountBalances", { ok: true });
  } catch (eBalances) {
    log_("sheetAccountBalancesError", String(eBalances));
  }
  try {
    getSystemMessagesSheet_();
    log_("sheetSystemMessages", { ok: true });
  } catch (eSystemMessages) {
    log_("sheetSystemMessagesError", String(eSystemMessages));
  }

  var testUser = props.EVS_TEST_USERNAME || "";
  var testPass = props.EVS_TEST_PASSWORD || "";
  if (testUser && testPass) {
    try {
      var t = evsLogin_(testUser, testPass);
      log_("evsLogin", { ok: true, tokenPrefix: t.slice(0, 8) });
      var meter = getMeterInfo_(t, testUser);
      log_("meterInfo", meter);
      var bal = getCreditBalance_(t, testUser);
      log_("creditBalance", bal);
      var usage = getMonthToDateUsage_(t, testUser);
      log_("mtdUsage", usage);
    } catch (err2) {
      log_("evsTestError", String(err2));
    }
  } else {
    log_("evsTest", "Set EVS_TEST_USERNAME and EVS_TEST_PASSWORD in Script Properties to run EVS checks.");
  }
}

function handleStatus_(chatId, user, options) {
  try {
    var username = normalizeUsername_(user.username);
    var token = evsLogin_(username, user.password);
    logEvent_("evs_status", {
      chat_id: chatId,
      step: "login_ok",
      token_prefix: token ? token.slice(0, 12) : "",
      username: username
    });
    var meterInfo = getMeterInfo_(token, username);
    var balance = getCreditBalance_(token, username);
    var usage = getMonthToDateUsage_(token, username);

    if (meterInfo && meterInfo.meter_sn) {
      setUser_(chatId, {
        meter_sn: meterInfo.meter_sn,
        meter_displayname: meterInfo.meter_displayname
      });
    }

    var lines = [];
    lines.push("Meter: " + (meterInfo.meter_displayname || user.username));
    if (meterInfo.meter_sn) lines.push("Meter SN: " + meterInfo.meter_sn);
    if (meterInfo.mms_online_timestamp) lines.push("Last online: " + meterInfo.mms_online_timestamp);

    lines.push("");
    var balanceAmount = getBalanceAmount_(balance);
    if (balanceAmount != null) {
      lines.push("<b>Balance: $" + Number(balanceAmount).toFixed(2) + "</b>");
    } else if (balance && balance.info) {
      lines.push("<b>Balance: " + String(balance.info) + "</b>");
    } else {
      var loggedBalance = getLatestLoggedBalance_(chatId, username);
      if (loggedBalance != null) {
        lines.push("<b>Balance (log): $" + Number(loggedBalance).toFixed(2) + "</b>");
        balanceAmount = loggedBalance;
      } else {
        lines.push("<b>Balance: unavailable</b>");
      }
    }
    lines.push("");
    
    if (usage && usage.month_to_date_usage != null) {
      var mtd = Math.abs(Number(usage.month_to_date_usage));
      lines.push("Month-to-date usage: " + mtd.toFixed(2));
    } else if (usage && usage.info) {
      lines.push("Month-to-date usage: " + String(usage.info));
    } else {
      lines.push("Month-to-date usage: unavailable");
    }
    try {
      var stat = getRecentUsageStat_(token, username, 168);
      var rank = stat && stat.usage_stat ? stat.usage_stat.kwh_rank_in_building : null;
      if (rank) {
        var rankLabel = formatRankTopPercent_(rank.rank_val);
        if (rankLabel) {
          if (rank.rank_type) {
            lines.push("Usage rank (" + rank.rank_type + "): " + rankLabel);
          } else {
            lines.push("Usage rank: " + rankLabel);
          }
        }
        if (rank.ref_val != null && rank.ref_val_unit) {
          lines.push("Energy usage (" + (rank.rank_type || "recent") + "): " + Number(rank.ref_val).toFixed(2) + " " + rank.ref_val_unit);
        }
      }
    } catch (eRank) {
      logEvent_("evs_rank_error", { chat_id: chatId, error: String(eRank) });
    }
    var projections = null;
    var avgLines = null;
    if (balanceAmount != null) {
      try {
        var history = getUsageHistory_(token, username, 30);
        if (!historyHasUsage_(history)) {
          history = getUsageHistoryFromLogs_(chatId, username, 30);
        }
        if (historyHasUsage_(history)) {
          projections = computeRunoutProjections_(history, balanceAmount);
          avgLines = computeAvgLines_(history);
        }
      } catch (eProj) {
        logEvent_("evs_runout_error", { chat_id: chatId, error: String(eProj) });
        var fallbackHistory = getUsageHistoryFromLogs_(chatId, username, 30);
        if (historyHasUsage_(fallbackHistory)) {
          projections = computeRunoutProjections_(fallbackHistory, balanceAmount);
          avgLines = computeAvgLines_(fallbackHistory);
        }
      }
    }
    if (avgLines && avgLines.length) {
      for (var a = 0; a < avgLines.length; a++) {
        lines.push(avgLines[a]);
      }
    }
    lines.push("");
    if (projections && projections.length) {
      for (var i = 0; i < projections.length; i++) {
        lines.push(projections[i]);
      }
    }
    lines.push('Top up / portal: <a href="https://nus-utown.evs.com.sg/EVSWebPOS/">EVS WebPOS</a>');

    sendHtmlMessage_(chatId, lines.join("\n"));
    return { ok: true };
  } catch (err) {
    logEvent_("evs_status_error", { chat_id: chatId, error: String(err) });
    if (!options || !options.suppressErrors) {
      sendMessage_(chatId, errorToMessage_(err));
    }
    return { ok: false, error: String(err) };
  }
}

function handleBalance_(chatId, user) {
  try {
    var username = normalizeUsername_(user.username);
    var token = evsLogin_(username, user.password);
    var balance = getCreditBalance_(token, username);
    var amount = null;
    if (balance && balance.credit_bal != null) amount = Number(balance.credit_bal);
    if (amount == null && balance && balance.ref_bal != null) amount = Number(balance.ref_bal);
    var msg = amount != null ? ("Balance: $" + amount.toFixed(2)) : (balance && balance.info ? ("Balance: " + String(balance.info)) : "Balance: unavailable");
    sendMessage_(chatId, msg);
  } catch (err) {
    sendMessage_(chatId, "Error: " + err);
  }
}

function handleUsage_(chatId, user) {
  try {
    var username = normalizeUsername_(user.username);
    var token = evsLogin_(username, user.password);
    var usage = getMonthToDateUsage_(token, username);
    var msg = "Month-to-date usage: unavailable";
    if (usage && usage.month_to_date_usage != null) {
      var mtd = Math.abs(Number(usage.month_to_date_usage));
      msg = "Month-to-date usage: " + mtd.toFixed(2);
    } else if (usage && usage.info) {
      msg = "Month-to-date usage: " + String(usage.info);
    }
    sendMessage_(chatId, msg);
  } catch (err) {
    sendMessage_(chatId, "Error: " + err);
  }
}

function handleUpgrade_(chatId, args) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var codes = getUpgradeCodes_(all);
  var user = getUser_(chatId) || {};
  if (isPremiumUser_(user)) {
    sendMessage_(chatId, "Premium already enabled.");
    return;
  }
  if (!codes.length) {
    sendMessage_(chatId, "Upgrade is not configured. Please contact the administrator.");
    return;
  }
  if (!args || !args.length) {
    sendMessage_(chatId, buildUpgradePromptMessage_(user));
    return;
  }
  var code = String(args[0] || "").trim();
  if (code && codes.indexOf(code) !== -1) {
    setUser_(chatId, { is_premium: "true", notify_enabled: "true", upgrade_code: code });
    setMyCommandsForChat_(chatId, getUser_(chatId));
    sendMessage_(chatId, "Upgrade successful. Premium features enabled.");
    return;
  }
  sendMessage_(chatId, "Invalid upgrade code.");
}

function buildUpgradePromptMessage_(user) {
  var lines = [];
  lines.push("Usage: /upgrade <code>");
  var waitInfo = getWaitlistInfo_(user);
  if (waitInfo) {
    lines.push("");
    lines.push("Waitlist: joined");
    lines.push("Joined: " + formatWaitlistJoinedLabel_(waitInfo.joined_at));
    lines.push("Position: " + waitInfo.position + " of " + waitInfo.total);
    lines.push("Use /leave_waitlist to leave the waitlist.");
  } else {
    lines.push("");
    lines.push("Not on waitlist. Use /join_waitlist to join.");
  }
  return lines.join("\n");
}

function handleWaitlistJoin_(chatId) {
  var user = getUser_(chatId) || {};
  var joinedAt = user.waitlist_joined_at ? String(user.waitlist_joined_at) : "";
  if (String(user.waitlist_status || "").toLowerCase() === "true" && joinedAt) {
    var info = getWaitlistInfo_(user);
    if (info) {
      sendMessage_(chatId, "Waitlist already joined. Position " + info.position + " of " + info.total + ". Joined " + formatWaitlistJoinedLabel_(info.joined_at) + ".");
      return;
    }
  }
  var nowIso = new Date().toISOString();
  setUser_(chatId, { waitlist_status: "true", waitlist_joined_at: nowIso });
  var info2 = getWaitlistInfo_(getUser_(chatId));
  if (info2) {
    sendMessage_(chatId, "Waitlist joined. Position " + info2.position + " of " + info2.total + ". Joined " + formatWaitlistJoinedLabel_(info2.joined_at) + ".");
    return;
  }
  sendMessage_(chatId, "Waitlist joined.");
}

function handleWaitlistLeave_(chatId) {
  var user = getUser_(chatId) || {};
  if (String(user.waitlist_status || "").toLowerCase() !== "true") {
    sendMessage_(chatId, "You are not on the waitlist.");
    return;
  }
  setUser_(chatId, { waitlist_status: "", waitlist_joined_at: "" });
  sendMessage_(chatId, "Removed from waitlist.");
}

function getWaitlistInfo_(user) {
  if (!user || String(user.waitlist_status || "").toLowerCase() !== "true") return null;
  var joinedAt = user.waitlist_joined_at ? String(user.waitlist_joined_at) : "";
  if (!joinedAt) return null;
  var queue = getWaitlistQueue_();
  if (!queue.length) return null;
  for (var i = 0; i < queue.length; i++) {
    if (String(queue[i].chat_id) === String(user.chat_id)) {
      return { position: i + 1, total: queue.length, joined_at: joinedAt };
    }
  }
  return null;
}

function getWaitlistQueue_() {
  var users = getAllUsers_();
  var out = [];
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (String(u.waitlist_status || "").toLowerCase() !== "true") continue;
    var joinedAt = u.waitlist_joined_at ? String(u.waitlist_joined_at) : "";
    if (!joinedAt) continue;
    out.push({ chat_id: u.chat_id, joined_at: joinedAt });
  }
  out.sort(function (a, b) {
    return String(a.joined_at).localeCompare(String(b.joined_at));
  });
  return out;
}

function formatWaitlistJoinedLabel_(joinedAt) {
  if (!joinedAt) return "unknown";
  var date = new Date(joinedAt);
  if (!isFinite(date.getTime())) return String(joinedAt);
  var sgt = formatSgtDateTime_(date) + " SGT";
  return sgt + " (" + formatRelativeAge_(date) + " ago)";
}

function formatRelativeAge_(date) {
  var now = new Date();
  var diffMs = now.getTime() - date.getTime();
  if (!isFinite(diffMs) || diffMs < 0) return "just now";
  var diffMin = Math.floor(diffMs / (60 * 1000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + " min";
  var diffHours = Math.floor(diffMin / 60);
  if (diffHours < 48) return diffHours + " h";
  var diffDays = Math.floor(diffHours / 24);
  return diffDays + " d";
}

function handleNotify_(chatId, user, args) {
  if (!isPremiumUser_(user)) {
    sendMessage_(chatId, "Premium required. Use /upgrade <code> to unlock notifications.");
    return;
  }
  if (!args || !args.length) {
    sendMessage_(chatId, buildNotifyStatusMessage_(user));
    return;
  }
  var cmd = String(args[0] || "").toLowerCase();
  if (cmd === "status") {
    sendMessage_(chatId, buildNotifyStatusMessage_(user));
    return;
  }
  if (cmd === "off") {
    setUser_(chatId, { notify_enabled: "false" });
    sendMessage_(chatId, "Notifications disabled.");
    return;
  }
  if (cmd === "on") {
    setUser_(chatId, { notify_enabled: "true" });
    sendMessage_(chatId, "Notifications enabled.");
    return;
  }
  if (cmd === "low") {
    if (args.length >= 2 && String(args[1]).toLowerCase() === "off") {
      setUser_(chatId, { notify_low_balance: "" });
      sendMessage_(chatId, "Low balance alerts disabled.");
      return;
    }
    var amount = args.length >= 2 ? Number(args[1]) : NaN;
    if (!isFinite(amount) || amount <= 0) {
      sendMessage_(chatId, "Usage: /notify low <amount> | /notify low off");
      return;
    }
    setUser_(chatId, { notify_low_balance: String(amount), notify_enabled: "true" });
    sendMessage_(chatId, "Low balance alert set to $" + amount.toFixed(2));
    return;
  }
  if (cmd === "runout") {
    if (args.length >= 2 && String(args[1]).toLowerCase() === "off") {
      setUser_(chatId, { notify_runout_days_ahead: "", notify_runout_windows: "" });
      sendMessage_(chatId, "Runout alerts disabled.");
      return;
    }
    var daysAhead = args.length >= 2 ? Number(args[1]) : NaN;
    if (!isFinite(daysAhead) || daysAhead < 0) {
      sendMessage_(chatId, "Usage: /notify runout <days-left> [7,14,30] | /notify runout off");
      return;
    }
    var windowsRaw = args.length >= 3 ? String(args[2]) : "7,14,30";
    var windows = parseWindows_(windowsRaw);
    if (!windows.length) {
      sendMessage_(chatId, "Usage: /notify runout <days-left> [7,14,30] | /notify runout off");
      return;
    }
    setUser_(chatId, {
      notify_runout_days_ahead: String(Math.floor(daysAhead)),
      notify_runout_windows: windows.join(","),
      notify_enabled: "true"
    });
    sendMessage_(chatId, "Runout alert set for " + Math.floor(daysAhead) + " days left using windows: " + windows.join(","));
    return;
  }
  sendMessage_(chatId, "Notify usage: /notify status | /notify low <amount> | /notify low off | /notify runout <days-left> [7,14,30] | /notify runout off | /notify on | /notify off");
}

function handleMyInfo_(chatId, user) {
  try {
    var username = normalizeUsername_(user.username);
    var token = evsLogin_(username, user.password);
    var meterInfo = getMeterInfo_(token, username);
    var balance = getCreditBalance_(token, username);

    if (meterInfo && meterInfo.meter_sn) {
      setUser_(chatId, {
        meter_sn: meterInfo.meter_sn,
        meter_displayname: meterInfo.meter_displayname
      });
    }

    var lines = [];
    var premise = meterInfo && meterInfo.premise ? meterInfo.premise : {};
    if (premise.block || premise.level || premise.unit) {
      var unitLine = [];
      if (premise.block) unitLine.push("Block " + premise.block);
      if (premise.level) unitLine.push("Level " + premise.level);
      if (premise.unit) unitLine.push("Unit " + premise.unit);
      lines.push("Location: " + unitLine.join(", "));
    }
    if (meterInfo && meterInfo.address) lines.push("Address: " + meterInfo.address);
    if (meterInfo && meterInfo.mms_address) lines.push("Meter address: " + meterInfo.mms_address);
    if (meterInfo && meterInfo.meter_sn) lines.push("Meter SN: " + meterInfo.meter_sn);
    if (meterInfo && meterInfo.meter_displayname) lines.push("Meter ID: " + meterInfo.meter_displayname);
    if (meterInfo && meterInfo.mms_online_timestamp) lines.push("Last online: " + meterInfo.mms_online_timestamp);
    if (meterInfo && meterInfo.reading_interval) lines.push("Reading interval: " + meterInfo.reading_interval + "s");
    if (meterInfo && meterInfo.voltage != null) lines.push("Voltage: " + meterInfo.voltage);
    if (meterInfo && meterInfo.current != null) lines.push("Current: " + meterInfo.current);
    if (meterInfo && meterInfo.tariff_price != null) lines.push("Tariff price: " + meterInfo.tariff_price);
    if (balance && balance.tariff_timestamp) lines.push("Tariff timestamp: " + balance.tariff_timestamp);
    lines.push("Top up / portal: https://nus-utown.evs.com.sg/EVSWebPOS/");

    if (!lines.length) {
      lines.push("No meter info available.");
    }
    sendMessage_(chatId, lines.join("\n"));
  } catch (err) {
    sendMessage_(chatId, "Error: " + err);
  }
}

function handleHistory_(chatId, user, args) {
  try {
    var username = normalizeUsername_(user.username);
    var token = evsLogin_(username, user.password);
    var days = 7;
    if (args && args.length) {
      var n = Number(args[0]);
      if (isFinite(n) && n > 0) days = Math.min(Math.max(Math.floor(n), 1), 90);
    }
    var history = getUsageHistory_(token, username, days + 1);
    var items = history && history.meter_reading_daily && history.meter_reading_daily.history
      ? history.meter_reading_daily.history.slice(0)
      : [];
    var subset = [];
    if (!items.length) {
      var fallback = getUsageHistoryFromLogs_(chatId, username, days);
      if (historyHasUsage_(fallback)) {
        subset = pickHistoryDays_(fallback.meter_reading_daily.history, days);
      } else {
        sendMessage_(chatId, "No history data available.");
        return;
      }
    } else {
      subset = pickHistoryDays_(items, days);
    }
    var lines = [];
    lines.push("Daily usage (last " + subset.length + " days):");
    for (var i = 0; i < subset.length; i++) {
      var item = subset[i] || {};
      var ts = item.reading_timestamp || "";
      var dateStr = ts ? String(ts).split("T")[0] : "";
      var diff = item.reading_diff != null ? Number(item.reading_diff) : null;
      var diffStr = diff != null && isFinite(diff) ? diff.toFixed(2) : "n/a";
      var est = item.is_estimated ? " (est)" : "";
      lines.push(dateStr + ": " + diffStr + est);
    }
    sendMessage_(chatId, lines.join("\n"));
  } catch (err) {
    sendMessage_(chatId, "Error: " + err);
  }
}

function pickHistoryDays_(items, days) {
  if (!items || !items.length) return [];
  var todayKey = dateKeySgt_();
  var byDay = {};
  items.sort(function (a, b) {
    return String(b.reading_timestamp).localeCompare(String(a.reading_timestamp));
  });
  var ordered = [];
  for (var i = 0; i < items.length; i++) {
    var ts = items[i] && items[i].reading_timestamp ? String(items[i].reading_timestamp) : "";
    var dayKey = ts ? ts.split("T")[0] : "";
    if (!dayKey || dayKey === todayKey) continue;
    if (byDay[dayKey]) continue;
    byDay[dayKey] = true;
    ordered.push(items[i]);
    if (ordered.length >= days) break;
  }
  return ordered;
}

function handleLeaderboard_(chatId, user, args) {
  try {
    var username = normalizeUsername_(user.username);
    var token = evsLogin_(username, user.password);
    var hoursList = [24, 168, 336, 720, 2160];
    var lines = [];
    lines.push("Usage leaderboard (recent usage stats):");
    var factor = getCarbonFactor_();
    var any = false;
    var seen = {};
    for (var i = 0; i < hoursList.length; i++) {
      var hours = hoursList[i];
    var stat = null;
    try {
      stat = getRecentUsageStat_(token, username, hours);
    } catch (eStat) {
      logEvent_("evs_recent_usage_stat_error", { chat_id: chatId, username: username, hours: hours, error: String(eStat) });
      continue;
    }
      var rank = stat && stat.usage_stat ? stat.usage_stat.kwh_rank_in_building : null;
      if (!rank) continue;
      var keyParts = [
        rank.rank_type || "",
        rank.rank_val || "",
        rank.rank_ref || "",
        rank.ref_val || "",
        rank.ref_val_unit || "",
        rank.updated_timestamp || ""
      ];
      var key = keyParts.join("|");
      if (seen[key]) continue;
      seen[key] = true;
      any = true;
      lines.push("");
      var label = rank.rank_type ? rank.rank_type : formatLookbackLabel_(hours);
      lines.push(label);
      var statLines = formatUsageStatLines_(rank, factor);
      for (var j = 0; j < statLines.length; j++) {
        lines.push(statLines[j]);
      }
    }
    if (!any) {
      sendMessage_(chatId, "No leaderboard data available.");
      return;
    }
    if (!factor) {
      lines.push("");
      lines.push("Carbon: unavailable (set EVS_CARBON_KG_PER_KWH in Script Properties).");
    }
    sendMessage_(chatId, lines.join("\n"));
  } catch (err) {
    sendMessage_(chatId, "Error: " + err);
  }
}

function handleData_(chatId, user, args) {
  if (!isPremiumUser_(user)) {
    sendMessage_(chatId, "Premium feature. Your balance data is not saved. Use /upgrade <code> to unlock.");
    return;
  }
  var days = 7;
  if (args && args.length) {
    var n = Number(args[0]);
    if (isFinite(n) && n > 0) days = Math.min(Math.max(Math.floor(n), 1), 90);
  }
  var logs = getBalanceLogs_(chatId, normalizeUsername_(user.username), days);
  if (!logs.length) {
    sendMessage_(chatId, "No balance data logged yet.");
    return;
  }
  var lines = [];
  lines.push("Balance logs (last " + days + " days):");
  for (var i = 0; i < logs.length; i++) {
    var row = logs[i];
    lines.push(formatSgtDateTime_(row.timestamp) + ": $" + Number(row.balance).toFixed(2) + (row.source ? (" (" + row.source + ")") : ""));
  }
  sendMessage_(chatId, lines.join("\n"));
}

function evsLogin_(username, password) {
  var url = EVS.authBase + "/login";
  var uname = normalizeUsername_(username);
  var payload = {
    username: uname,
    password: String(password || ""),
    destPortal: "evs2cp",
    platform: "web"
  };
  if (DEBUG) log_("evsLoginRequest", { url: url, username: uname });
  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (DEBUG) log_("evsLoginResponse", { code: resp.getResponseCode(), body: resp.getContentText() });
  var data = JSON.parse(resp.getContentText() || "{}");
  logEvent_("evs_login_meta", {
    username: uname,
    scope_str: data.userInfo ? data.userInfo.scope_str : "",
    roles: data.userInfo ? data.userInfo.roles : [],
    dest_portal: data.userInfo ? data.userInfo.dest_portal : "",
    user_id: data.userInfo ? data.userInfo.id : null,
    token_prefix: data.token ? String(data.token).slice(0, 12) : ""
  });
  if (!data.token) {
    throw "Login failed: " + (data.err || "unknown error");
  }
  return data.token;
}

function evsOreRequest_(token, endpoint, target, operation, requestBody, username) {
  var uname = normalizeUsername_(username);
  var endpointPath = endpoint;
  if (endpointPath && String(endpointPath).indexOf("http") === 0) {
    try {
      endpointPath = "/" + String(endpointPath).split("/").slice(3).join("/");
    } catch (e) {
      endpointPath = endpoint;
    }
  }
  var payload = {
    svcClaimDto: {
      username: uname,
      user_id: null,
      svcName: "oresvc",
      endpoint: endpointPath,
      scope: "self",
      target: target,
      operation: operation
    },
    request: requestBody
  };

  if (DEBUG) log_("evsOreRequest", { endpoint: endpoint, target: target, operation: operation, request: requestBody });
  var resp = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var text = resp.getContentText() || "";
  if (DEBUG) log_("evsOreResponse", { endpoint: endpoint, code: code, body: text });
  if (code >= 400) {
    logEvent_("evs_ore_error", {
      endpoint: endpoint,
      code: code,
      username: uname,
      target: target,
      operation: operation,
      response: text,
      request: requestBody
    });
  }
  if (code === 403) {
    throw "Not authorized for this operation.";
  }
  if (code >= 400) {
    throw "Request failed: " + text;
  }
  return JSON.parse(text || "{}");
}

function getMeterInfo_(token, username) {
  var uname = normalizeUsername_(username);
  var endpoint = EVS.oreBase + "/cp/get_meter_info";
  var data = evsOreRequest_(
    token,
    endpoint,
    "meter.p.info",
    "read",
    { meter_displayname: uname },
    uname
  );
  return data.meter_info || {};
}

function getCreditBalance_(token, username) {
  var uname = normalizeUsername_(username);
  var endpoint = EVS.oreBase + "/tcm/get_credit_balance";
  var res = evsOreRequest_(
    token,
    endpoint,
    "meter.credit_balance",
    "read",
    { meter_displayname: uname },
    uname
  );
  if (res && (res.credit_bal != null || res.ref_bal != null)) {
    res._source = "evs2";
  }
  if (shouldFallbackCreditBalance_(res)) {
    try {
      var evs1Endpoint = EVS.oreBase + "/evs1/get_credit_bal";
      var evs1Res = evsOreRequest_(
        token,
        evs1Endpoint,
        "meter.credit_balance",
        "read",
        { meter_displayname: uname },
        uname
      );
      if (evs1Res && (evs1Res.credit_bal != null || evs1Res.ref_bal != null)) {
        evs1Res._source = "evs1";
        return evs1Res;
      }
    } catch (e) {
      logEvent_("evs1_credit_balance_error", { username: uname, error: String(e) });
    }
  }
  return res;
}

function shouldFallbackCreditBalance_(balance) {
  if (!balance) return true;
  if (balance.credit_bal != null || balance.ref_bal != null) return false;
  if (balance.info && String(balance.info).toLowerCase().indexOf("not found") !== -1) return true;
  return true;
}

function getMonthToDateUsage_(token, username) {
  var uname = normalizeUsername_(username);
  var endpoint = EVS.oreBase + "/get_month_to_date_usage";
  return evsOreRequest_(
    token,
    endpoint,
    "meter.p.month_to_date_kwh_usage",
    "read",
    { meter_displayname: uname, convert_to_money: "true" },
    uname
  );
}

function getRecentUsageStat_(token, username, lookBackHours) {
  var uname = normalizeUsername_(username);
  var hours = lookBackHours != null ? Number(lookBackHours) : 168;
  if (!isFinite(hours) || hours <= 0) hours = 168;
  var endpoint = EVS.oreBase + "/cp/get_recent_usage_stat";
  return evsOreRequest_(
    token,
    endpoint,
    "meter.reading",
    "list",
    { meter_displayname: uname, look_back_hours: hours, convert_to_money: true },
    uname
  );
}

function getUsageHistory_(token, username) {
  var uname = normalizeUsername_(username);
  var endpoint = EVS.oreBase + "/get_history";
  var days = 7;
  if (arguments.length >= 3) {
    var n = Number(arguments[2]);
    if (isFinite(n) && n > 0) days = Math.min(Math.max(Math.floor(n), 1), 90);
  }
  var end = new Date();
  var start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));
  var requestBody = {
    meter_displayname: uname,
    history_type: "meter_reading_daily",
    start_datetime: formatEvsDate_(start),
    end_datetime: formatEvsDate_(end),
    normalization: "meter_reading_daily",
    max_number_of_records: "50",
    convert_to_money: "true",
    check_bypass: "true"
  };
  return evsOreRequest_(token, endpoint, "meter.reading", "list", requestBody, uname);
}

function formatEvsDate_(d) {
  var iso = new Date(d).toISOString();
  return iso.replace("T", " ").replace("Z", "Z");
}

function getCarbonFactor_() {
  var raw = PropertiesService.getScriptProperties().getProperty("EVS_CARBON_KG_PER_KWH");
  if (!raw) return null;
  var val = Number(raw);
  return isFinite(val) && val > 0 ? val : null;
}

function formatLookbackLabel_(hours) {
  var h = Number(hours);
  if (!isFinite(h) || h <= 0) return String(hours || "");
  if (h % 24 === 0) {
    var d = h / 24;
    if (d === 1) return "24h";
    return d + "d";
  }
  return h + "h";
}

function formatUsageStatLines_(rank, carbonFactor) {
  var lines = [];
  if (!rank) return lines;
  if (rank.id) lines.push("ID: " + rank.id);
  if (rank.rank_type) lines.push("Rank type: " + rank.rank_type);
  var rankLabel = formatRankTopPercent_(rank.rank_val);
  if (rankLabel) lines.push("Rank: " + rankLabel);
  if (rank.rank_ref) lines.push("Rank ref: " + rank.rank_ref);
  if (rank.ref_val != null) {
    var refValNum = Number(rank.ref_val);
    var refValStr = isFinite(refValNum) ? refValNum.toFixed(2) : String(rank.ref_val);
    lines.push("Ref usage: " + refValStr + (rank.ref_val_unit ? (" " + rank.ref_val_unit) : ""));
  }
  if (rank.ref_val_unit) lines.push("Ref unit: " + rank.ref_val_unit);
  if (rank.updated_timestamp) lines.push("Updated: " + rank.updated_timestamp);
  if (rank.meter_sn) lines.push("Meter SN: " + rank.meter_sn);
  if (rank.meter_displayname) lines.push("Meter ID: " + rank.meter_displayname);
  if (carbonFactor && rank.ref_val != null && rank.ref_val_unit && String(rank.ref_val_unit).toLowerCase().indexOf("kwh") !== -1) {
    var refNum = Number(rank.ref_val);
    if (isFinite(refNum)) {
      lines.push("Carbon (ref): " + (refNum * carbonFactor).toFixed(2) + " kg CO2e (" + carbonFactor + " kg/kWh)");
    }
  }
  return lines;
}

function formatRankTopPercent_(rankVal) {
  if (rankVal == null) return "";
  var num = Number(rankVal);
  if (!isFinite(num)) return "";
  var pct = num;
  if (pct > 0 && pct <= 1) pct = pct * 100;
  if (pct < 0) return "";
  return "Top " + Math.round(pct) + "%";
}

function getBalanceAmount_(balance) {
  if (balance && balance.credit_bal != null) {
    var val = Number(balance.credit_bal);
    return isFinite(val) ? val : null;
  }
  if (balance && balance.ref_bal != null) {
    var ref = Number(balance.ref_bal);
    return isFinite(ref) ? ref : null;
  }
  return null;
}

function computeRunoutProjections_(history, balanceAmount) {
  if (balanceAmount == null || !isFinite(balanceAmount) || balanceAmount <= 0) return [];
  var items = history && history.meter_reading_daily && history.meter_reading_daily.history
    ? history.meter_reading_daily.history.slice(0)
    : [];
  if (!items.length) return [];
  items.sort(function (a, b) {
    return String(b.reading_timestamp).localeCompare(String(a.reading_timestamp));
  });
  var windows = [7, 14, 30];
  var lines = [];
  for (var i = 0; i < windows.length; i++) {
    var w = windows[i];
    var avg = computeAvgDaily_(items, w);
    if (avg == null || avg <= 0) continue;
    var daysLeft = balanceAmount / avg;
    var runoutDate = new Date(Date.now() + Math.max(daysLeft, 0) * 24 * 60 * 60 * 1000);
    lines.push("Runout (" + w + "d avg): " + formatSgtDateLabel_(runoutDate) + " (~" + Math.ceil(daysLeft) + " days)");
  }
  return lines;
}

function computeAvgLines_(history) {
  var items = history && history.meter_reading_daily && history.meter_reading_daily.history
    ? history.meter_reading_daily.history.slice(0)
    : [];
  if (!items.length) return [];
  items.sort(function (a, b) {
    return String(b.reading_timestamp).localeCompare(String(a.reading_timestamp));
  });
  var windows = [7, 14, 30];
  var lines = [];
  for (var i = 0; i < windows.length; i++) {
    var w = windows[i];
    var avg = computeAvgDaily_(items, w);
    if (avg == null || !isFinite(avg)) continue;
    lines.push("Avg daily (" + w + "d): " + avg.toFixed(2));
  }
  return lines;
}

function computeAvgDaily_(items, days) {
  if (!items || !items.length) return null;
  var count = Math.min(days, items.length);
  var sum = 0;
  var used = 0;
  for (var i = 0; i < count; i++) {
    var diff = items[i] && items[i].reading_diff != null ? Number(items[i].reading_diff) : null;
    if (diff == null || !isFinite(diff)) continue;
    sum += Math.abs(diff);
    used++;
  }
  if (!used) return null;
  return sum / used;
}

function formatSgtDateLabel_(date) {
  var d = new Date(date.getTime() + (8 * 60 * 60 * 1000));
  var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return days[d.getUTCDay()] + " " + d.getUTCDate() + " " + months[d.getUTCMonth()];
}

function isPremiumUser_(user) {
  return user && String(user.is_premium || "").toLowerCase() === "true";
}

function parseWindows_(raw) {
  var parts = String(raw || "").split(",");
  var allowed = { "7": true, "14": true, "30": true };
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = String(parts[i] || "").trim();
    if (allowed[p] && out.indexOf(p) === -1) out.push(p);
  }
  return out;
}

function buildNotifyStatusMessage_(user) {
  var enabled = String(user.notify_enabled || "").toLowerCase() === "true";
  var low = user.notify_low_balance ? Number(user.notify_low_balance) : null;
  var runoutDays = user.notify_runout_days_ahead ? Number(user.notify_runout_days_ahead) : null;
  var windows = user.notify_runout_windows || "7,14,30";
  var windowsIsDefault = !user.notify_runout_windows;
  var lines = [];
  lines.push("Notifications: " + (enabled ? "on" : "off"));
  lines.push("Low balance: " + (low != null && isFinite(low) ? ("$" + low.toFixed(2)) : "not set"));
  lines.push("Runout: " + (runoutDays != null && isFinite(runoutDays) ? (runoutDays + " days left") : "not set"));
  lines.push("Runout windows: " + windows + (windowsIsDefault ? " (default)" : ""));
  lines.push("Usage:");
  lines.push("/notify low <amount> | /notify low off");
  lines.push("/notify runout <days-left> [7,14,30] | /notify runout off");
  lines.push("/notify on | /notify off");
  return lines.join("\n");
}

function dateKeySgt_() {
  var now = new Date();
  var sgt = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  var y = sgt.getUTCFullYear();
  var m = String(sgt.getUTCMonth() + 1);
  if (m.length < 2) m = "0" + m;
  var d = String(sgt.getUTCDate());
  if (d.length < 2) d = "0" + d;
  return y + "-" + m + "-" + d;
}

function getAllUsers_() {
  var sheet = getUsersSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var users = [];
  for (var i = 1; i < data.length; i++) {
    users.push(rowToUser_(data[i]));
  }
  return users;
}

function computeRunoutForWindows_(history, balanceAmount, windows) {
  if (balanceAmount == null || !isFinite(balanceAmount) || balanceAmount <= 0) return [];
  var items = history && history.meter_reading_daily && history.meter_reading_daily.history
    ? history.meter_reading_daily.history.slice(0)
    : [];
  if (!items.length) return [];
  items.sort(function (a, b) {
    return String(b.reading_timestamp).localeCompare(String(a.reading_timestamp));
  });
  var out = [];
  for (var i = 0; i < windows.length; i++) {
    var w = windows[i];
    var avg = computeAvgDaily_(items, w);
    if (avg == null || avg <= 0) continue;
    var daysLeft = balanceAmount / avg;
    var runoutDate = new Date(Date.now() + Math.max(daysLeft, 0) * 24 * 60 * 60 * 1000);
    out.push({
      window: w,
      days_left: daysLeft,
      runout_date: runoutDate
    });
  }
  return out;
}

function checkNotifications_() {
  var users = getAllUsers_();
  if (!users.length) return;
  var todayKey = dateKeySgt_();
  for (var i = 0; i < users.length; i++) {
    var user = users[i];
    if (!isPremiumUser_(user)) continue;
    if (String(user.notify_enabled || "").toLowerCase() !== "true") continue;
    if (!user.username || !user.password) continue;
    try {
      var uname = normalizeUsername_(user.username);
      var token = evsLogin_(uname, user.password);
      var balance = getCreditBalance_(token, uname);
      var amount = getBalanceAmount_(balance);
      var loggedBalance = null;
      if (amount == null || !isFinite(amount)) {
        loggedBalance = getLatestLoggedBalance_(user.chat_id, uname);
        if (loggedBalance != null && isFinite(loggedBalance)) {
          amount = loggedBalance;
        }
      }
      if (amount != null && isFinite(amount)) {
        var low = user.notify_low_balance ? Number(user.notify_low_balance) : null;
        if (low != null && isFinite(low) && amount <= low) {
          var lastLowKey = normalizeDateKey_(user.notify_last_low_date);
          if (lastLowKey !== todayKey) {
            var prefix = balance && balance._source === "evs1" ? "Low balance alert (evs1): " : "Low balance alert: ";
            if (balance == null || amount === loggedBalance) prefix = "Low balance alert (log): ";
            sendMessage_(user.chat_id, prefix + "$" + amount.toFixed(2) + " remaining (threshold $" + low.toFixed(2) + ").");
            setUser_(user.chat_id, { notify_last_low_date: todayKey });
          }
        }
      }
      var runoutDaysAhead = user.notify_runout_days_ahead ? Number(user.notify_runout_days_ahead) : null;
      var windows = parseWindows_(user.notify_runout_windows || "7,14,30");
      if (runoutDaysAhead != null && isFinite(runoutDaysAhead) && windows.length) {
        var history = getUsageHistory_(token, uname, Math.max.apply(null, windows));
        if (!historyHasUsage_(history)) {
          history = getUsageHistoryFromLogs_(user.chat_id, uname, Math.max.apply(null, windows));
        }
        var projections = computeRunoutForWindows_(history, amount, windows);
        var alerts = [];
        for (var p = 0; p < projections.length; p++) {
          var proj = projections[p];
          if (proj.days_left <= runoutDaysAhead) {
            alerts.push(proj);
          }
        }
        var lastRunoutKey = normalizeDateKey_(user.notify_last_runout_date);
        if (alerts.length && lastRunoutKey !== todayKey) {
          var lines = ["Projected runout alert:"];
          for (var a = 0; a < alerts.length; a++) {
            var item = alerts[a];
            lines.push(item.window + "d avg: " + formatSgtDateLabel_(item.runout_date) + " (~" + Math.ceil(item.days_left) + " days)");
          }
          sendMessage_(user.chat_id, lines.join("\n"));
          setUser_(user.chat_id, { notify_last_runout_date: todayKey });
        }
      }
    } catch (err) {
      logEvent_("notify_error", { chat_id: user.chat_id, error: String(err) });
    }
  }
}

function normalizeDateKey_(val) {
  if (!val) return "";
  if (typeof val === "number" && isFinite(val)) {
    // Google Sheets date serial (days since 1899-12-30)
    if (val > 20000) {
      var ms = (val - 25569) * 24 * 60 * 60 * 1000;
      return normalizeDateKey_(new Date(ms));
    }
    return String(val);
  }
  if (typeof val === "string") {
    var trimmed = val.trim();
    if (!trimmed) return "";
    var num = Number(trimmed);
    if (isFinite(num) && num > 20000) {
      var ms2 = (num - 25569) * 24 * 60 * 60 * 1000;
      return normalizeDateKey_(new Date(ms2));
    }
    return trimmed;
  }
  if (Object.prototype.toString.call(val) === "[object Date]") {
    var d = new Date(val);
    var sgt = new Date(d.getTime() + (8 * 60 * 60 * 1000));
    var y = sgt.getUTCFullYear();
    var m = String(sgt.getUTCMonth() + 1);
    if (m.length < 2) m = "0" + m;
    var day = String(sgt.getUTCDate());
    if (day.length < 2) day = "0" + day;
    return y + "-" + m + "-" + day;
  }
  return String(val);
}

function automationsDaily() {
  logEvent_("automation_run", { name: "automationsDaily" });
  clearOldLogs_();
}

function automationsHourly() {
  logEvent_("automation_run", { name: "automationsHourly" });
  logPremiumBalances_();
  checkNotifications_();
}

function runAutomations() {
  logEvent_("automation_run", { name: "runAutomations" });
  automationsDaily();
  automationsHourly();
}

function getUpgradeCodes_(props) {
  var all = props || PropertiesService.getScriptProperties().getProperties();
  var codes = [];
  for (var key in all) {
    if (!all.hasOwnProperty(key)) continue;
    if (key.indexOf("TELEGRAM_UPGRADE_CODE") === 0) {
      var val = String(all[key] || "").trim();
      if (val && codes.indexOf(val) === -1) codes.push(val);
    }
  }
  return codes;
}

function sendMessage_(chatId, text) {
  // Plain-text sender (no parse_mode). Use sendHtmlMessage_ when you include Telegram HTML tags.
  return sendMessageWithOptions_(chatId, text, null);
}

function sendHtmlMessage_(chatId, htmlText) {
  // HTML sender for Telegram-supported HTML tags like <b>, <i>, <code>, etc.
  return sendMessageWithOptions_(chatId, htmlText, { parse_mode: "HTML" });
}

function sendMessageWithOptions_(chatId, text, options) {
  var payload = {
    chat_id: chatId,
    text: text
  };
  if (options) {
    if (options.parse_mode) payload.parse_mode = options.parse_mode;
    if (options.reply_markup) payload.reply_markup = options.reply_markup;
    if (options.disable_web_page_preview != null) payload.disable_web_page_preview = options.disable_web_page_preview;
    if (options.disable_notification != null) payload.disable_notification = options.disable_notification;
    if (options.reply_to_message_id != null) payload.reply_to_message_id = options.reply_to_message_id;
    if (options.allow_sending_without_reply != null) payload.allow_sending_without_reply = options.allow_sending_without_reply;
  }
  var res = tgRequest_("sendMessage", payload);
  logEvent_("outgoing", { chat_id: chatId, text: text, ok: res.ok, error_code: res.error_code });
  return res;
}

function getBotToken_() {
  var token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
  if (!token) throw "Missing TELEGRAM_BOT_TOKEN in Script Properties";
  token = String(token).trim();
  if (/^bot\\d+:/i.test(token)) token = token.replace(/^bot/i, "");
  return token;
}

function setWebhook() {
  var hookUrl = ScriptApp.getService().getUrl();
  return setWebhookWithUrl(hookUrl);
}

function setWebhookWithUrl(hookUrl) {
  var payload = {
    url: hookUrl,
    drop_pending_updates: true,
    allowed_updates: getAllowedUpdates_()
  };
  return tgRequest_("setWebhook", payload);
}

function setWebhookAuto() {
  var props = PropertiesService.getScriptProperties();
  var hookUrl = props.getProperty("TELEGRAM_WEBHOOK_URL") || "";
  if (!hookUrl) hookUrl = ScriptApp.getService().getUrl();
  if (!hookUrl) throw "Missing webhook URL. Set TELEGRAM_WEBHOOK_URL in Script Properties.";
  return setWebhookWithUrl(hookUrl);
}

function resetWebhook() {
  tgRequest_("deleteWebhook", { drop_pending_updates: true });
  return setWebhookAuto();
}

function getWebhookInfo() {
  return tgRequest_("getWebhookInfo", null);
}

function telegramGetMe() {
  return tgRequest_("getMe", null);
}

function setBotToken_(token) {
  PropertiesService.getScriptProperties().setProperty("TELEGRAM_BOT_TOKEN", token);
}

function getUser_(chatId) {
  var sheet = getUsersSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === chatId) {
      return rowToUser_(data[i]);
    }
  }
  return null;
}

function setUser_(chatId, fields) {
  var sheet = getUsersSheet_();
  var data = sheet.getDataRange().getValues();
  var row = null;
  if (data.length >= 2) {
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === chatId) {
        row = i + 1;
        break;
      }
    }
  }

  var now = new Date();
  if (!row) {
    var newRow = [
      chatId,
      fields.username || "",
      fields.password || "",
      fields.state || "",
      fields.meter_displayname || "",
      fields.meter_sn || "",
      now.toISOString(),
      fields.tg_username || "",
      fields.tg_first_name || "",
      fields.tg_last_name || "",
      fields.is_premium || "",
      fields.upgrade_code || "",
      fields.notify_enabled || "",
      fields.notify_low_balance || "",
      fields.notify_runout_days_ahead || "",
      fields.notify_runout_windows || "",
      fields.notify_last_low_date || "",
      fields.notify_last_runout_date || "",
      fields.waitlist_status || "",
      fields.waitlist_joined_at || ""
    ];
    sheet.appendRow(newRow);
  } else {
    var current = rowToUser_(sheet.getRange(row, 1, 1, 20).getValues()[0]);
    var updated = [
      chatId,
      fields.username != null ? fields.username : current.username,
      fields.password != null ? fields.password : current.password,
      fields.state != null ? fields.state : current.state,
      fields.meter_displayname != null ? fields.meter_displayname : current.meter_displayname,
      fields.meter_sn != null ? fields.meter_sn : current.meter_sn,
      now.toISOString(),
      fields.tg_username != null ? fields.tg_username : current.tg_username,
      fields.tg_first_name != null ? fields.tg_first_name : current.tg_first_name,
      fields.tg_last_name != null ? fields.tg_last_name : current.tg_last_name,
      fields.is_premium != null ? fields.is_premium : current.is_premium,
      fields.upgrade_code != null ? fields.upgrade_code : current.upgrade_code,
      fields.notify_enabled != null ? fields.notify_enabled : current.notify_enabled,
      fields.notify_low_balance != null ? fields.notify_low_balance : current.notify_low_balance,
      fields.notify_runout_days_ahead != null ? fields.notify_runout_days_ahead : current.notify_runout_days_ahead,
      fields.notify_runout_windows != null ? fields.notify_runout_windows : current.notify_runout_windows,
      fields.notify_last_low_date != null ? fields.notify_last_low_date : current.notify_last_low_date,
      fields.notify_last_runout_date != null ? fields.notify_last_runout_date : current.notify_last_runout_date,
      fields.waitlist_status != null ? fields.waitlist_status : current.waitlist_status,
      fields.waitlist_joined_at != null ? fields.waitlist_joined_at : current.waitlist_joined_at
    ];
    sheet.getRange(row, 1, 1, 20).setValues([updated]);
  }
}

function rowToUser_(row) {
  return {
    chat_id: String(row[0] || ""),
    username: row[1] || "",
    password: row[2] || "",
    state: row[3] || "",
    meter_displayname: row[4] || "",
    meter_sn: row[5] || "",
    updated_at: row[6] || "",
    tg_username: row[7] || "",
    tg_first_name: row[8] || "",
    tg_last_name: row[9] || "",
    is_premium: row[10] || "",
    upgrade_code: row[11] || "",
    notify_enabled: row[12] || "",
    notify_low_balance: row[13] || "",
    notify_runout_days_ahead: row[14] || "",
    notify_runout_windows: row[15] || "",
    notify_last_low_date: row[16] || "",
    notify_last_runout_date: row[17] || "",
    waitlist_status: row[18] || "",
    waitlist_joined_at: row[19] || ""
  };
}

function getUsersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("users");
  if (!sheet) {
    sheet = ss.insertSheet("users");
  }
  ensureUsersHeader_(sheet);
  return sheet;
}

function ensureUsersHeader_(sheet) {
  var header = [
    "chat_id",
    "username",
    "password",
    "state",
    "meter_displayname",
    "meter_sn",
    "updated_at",
    "tg_username",
    "tg_first_name",
    "tg_last_name",
    "is_premium",
    "upgrade_code",
    "notify_enabled",
    "notify_low_balance",
    "notify_runout_days_ahead",
    "notify_runout_windows",
    "notify_last_low_date",
    "notify_last_runout_date",
    "waitlist_status",
    "waitlist_joined_at"
  ];
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(header);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var changed = false;
  for (var i = 0; i < header.length; i++) {
    if (!existing[i]) {
      existing[i] = header[i];
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, header.length).setValues([existing.slice(0, header.length)]);
  }
  if (sheet.getLastColumn() < header.length) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), header.length - sheet.getLastColumn());
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function getLogsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("logs");
  if (!sheet) {
    sheet = ss.insertSheet("logs");
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "timestamp",
      "type",
      "chat_id",
      "text",
      "data_json"
    ]);
  }
  return sheet;
}

function getSystemMessagesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("system_messages");
  if (!sheet) {
    sheet = ss.insertSheet("system_messages");
  }
  ensureSystemMessagesHeader_(sheet);
  return sheet;
}

function ensureSystemMessagesHeader_(sheet) {
  var header = [
    "message",
    "sent_at",
    "sent_chat_ids",
    "sent_count"
  ];
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(header);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var changed = false;
  for (var i = 0; i < header.length; i++) {
    if (!existing[i]) {
      existing[i] = header[i];
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, header.length).setValues([existing.slice(0, header.length)]);
  }
  if (sheet.getLastColumn() < header.length) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), header.length - sheet.getLastColumn());
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function sendSystemMessages() {
  var sheet = getSystemMessagesSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var users = getAllUsers_();
  if (!users.length) return;
  var sentRows = 0;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var message = row[0] != null ? String(row[0]).trim() : "";
    var sentAt = row[1];
    if (!message) continue;
    if (sentAt) continue;
    var sentChatIds = [];
    for (var u = 0; u < users.length; u++) {
      var chatId = users[u].chat_id;
      if (!chatId) continue;
      var res = sendHtmlMessage_(chatId, message);
      if (res && res.ok) sentChatIds.push(String(chatId));
    }
    var nowIso = new Date().toISOString();
    sheet.getRange(i + 1, 2, 1, 3).setValues([[nowIso, JSON.stringify(sentChatIds), sentChatIds.length]]);
    sentRows++;
    logEvent_("system_message_sent", { row: i + 1, sent_count: sentChatIds.length });
  }
  if (sentRows) {
    logEvent_("system_messages_run", { rows_sent: sentRows });
  }
}

function getAccountBalancesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("account_balances");
  if (!sheet) {
    sheet = ss.insertSheet("account_balances");
  }
  ensureAccountBalancesHeader_(sheet);
  return sheet;
}

function ensureAccountBalancesHeader_(sheet) {
  var header = [
    "timestamp",
    "chat_id",
    "username",
    "balance",
    "source",
    "data_json"
  ];
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(header);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var changed = false;
  for (var i = 0; i < header.length; i++) {
    if (!existing[i]) {
      existing[i] = header[i];
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, header.length).setValues([existing.slice(0, header.length)]);
  }
  if (sheet.getLastColumn() < header.length) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), header.length - sheet.getLastColumn());
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function logBalanceSample_(chatId, username, balanceObj, amount) {
  if (amount == null || !isFinite(amount)) return;
  try {
    var sheet = getAccountBalancesSheet_();
    var ts = new Date().toISOString();
    var source = balanceObj && balanceObj._source ? String(balanceObj._source) : "";
    var json = JSON.stringify(balanceObj || {});
    sheet.appendRow([ts, String(chatId || ""), String(username || ""), Number(amount), source, json]);
  } catch (e) {
    logEvent_("balance_log_error", { chat_id: chatId, error: String(e) });
  }
}

function upsertDailyBalanceSample_(chatId, username, balanceObj, amount) {
  if (amount == null || !isFinite(amount)) return;
  try {
    var sheet = getAccountBalancesSheet_();
    var ts = new Date();
    var tsIso = ts.toISOString();
    var dayKey = formatSgtDateKey_(ts);
    var source = balanceObj && balanceObj._source ? String(balanceObj._source) : "";
    var json = JSON.stringify(balanceObj || {});
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      sheet.appendRow([tsIso, String(chatId || ""), String(username || ""), Number(amount), source, json]);
      return;
    }
    var rowToUpdate = null;
    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      var rowChat = String(row[1] || "");
      var rowUser = String(row[2] || "");
      if (rowChat !== String(chatId || "")) continue;
      if (rowUser !== String(username || "")) continue;
      var rowTs = row[0] ? new Date(row[0]) : null;
      if (!rowTs || !isFinite(rowTs.getTime())) continue;
      if (formatSgtDateKey_(rowTs) === dayKey) {
        rowToUpdate = i + 1;
        break;
      }
    }
    if (rowToUpdate) {
      sheet.getRange(rowToUpdate, 1, 1, 6).setValues([[tsIso, String(chatId || ""), String(username || ""), Number(amount), source, json]]);
      return;
    }
    sheet.appendRow([tsIso, String(chatId || ""), String(username || ""), Number(amount), source, json]);
  } catch (e) {
    logEvent_("balance_log_error", { chat_id: chatId, error: String(e) });
  }
}

function getBalanceLogs_(chatId, username, days) {
  var sheet = getAccountBalancesSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var cutoff = null;
  if (days && isFinite(days)) {
    cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  }
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowChat = String(row[1] || "");
    var rowUser = String(row[2] || "");
    if (chatId && rowChat !== String(chatId)) continue;
    if (username && rowUser !== String(username)) continue;
    var ts = row[0];
    var tsDate = ts ? new Date(ts) : null;
    if (cutoff && tsDate && tsDate < cutoff) continue;
    out.push({
      timestamp: ts,
      chat_id: rowChat,
      username: rowUser,
      balance: Number(row[3]),
      source: row[4] || "",
      data_json: row[5] || ""
    });
  }
  out.sort(function (a, b) {
    return String(b.timestamp).localeCompare(String(a.timestamp));
  });
  return out;
}

function getLatestLoggedBalance_(chatId, username) {
  var logs = getBalanceLogs_(chatId, username, 90);
  if (!logs.length) return null;
  var val = Number(logs[0].balance);
  return isFinite(val) ? val : null;
}

function getLastBalanceLogTimestamp_(chatId, username) {
  var logs = getBalanceLogs_(chatId, username, 30);
  if (!logs.length || !logs[0].timestamp) return null;
  var d = new Date(logs[0].timestamp);
  return isFinite(d.getTime()) ? d : null;
}

function shouldLogBalanceNow_(chatId, username, minMinutes) {
  var last = getLastBalanceLogTimestamp_(chatId, username);
  if (!last) return true;
  var diffMin = (Date.now() - last.getTime()) / (60 * 1000);
  return diffMin >= (minMinutes || 60);
}

function logPremiumBalances_() {
  var users = getAllUsers_();
  if (!users.length) return;
  for (var i = 0; i < users.length; i++) {
    var user = users[i];
    if (!isPremiumUser_(user)) continue;
    if (!user.username || !user.password) continue;
    if (!shouldLogBalanceNow_(user.chat_id, user.username, 60)) continue;
    try {
      var uname = normalizeUsername_(user.username);
      var token = evsLogin_(uname, user.password);
      var balance = getCreditBalance_(token, uname);
      var amount = getBalanceAmount_(balance);
      if (amount != null && isFinite(amount)) {
        upsertDailyBalanceSample_(user.chat_id, uname, balance, amount);
      }
    } catch (err) {
      logEvent_("balance_log_error", { chat_id: user.chat_id, error: String(err) });
    }
  }
}

function getUsageHistoryFromLogs_(chatId, username, days) {
  var logs = getBalanceLogs_(chatId, username, 90);
  if (!logs.length) return null;
  var byDay = {};
  for (var i = 0; i < logs.length; i++) {
    var ts = logs[i].timestamp;
    if (!ts) continue;
    var dayKey = formatSgtDateKey_(new Date(ts));
    if (!byDay[dayKey] || String(ts).localeCompare(String(byDay[dayKey].timestamp)) > 0) {
      byDay[dayKey] = logs[i];
    }
  }
  var daysList = Object.keys(byDay).sort(function (a, b) { return String(b).localeCompare(String(a)); });
  var history = [];
  for (var d = 0; d < daysList.length - 1; d++) {
    var day = daysList[d];
    var nextDay = daysList[d + 1];
    var currentBal = Number(byDay[day].balance);
    var prevBal = Number(byDay[nextDay].balance);
    if (!isFinite(currentBal) || !isFinite(prevBal)) continue;
    var diff = Math.max(0, prevBal - currentBal);
    history.push({
      reading_timestamp: day + "T00:00:00",
      reading_diff: diff,
      is_estimated: true
    });
    if (days && history.length >= days) break;
  }
  return {
    meter_reading_daily: {
      history: history
    }
  };
}

function historyHasUsage_(history) {
  return history && history.meter_reading_daily && history.meter_reading_daily.history && history.meter_reading_daily.history.length;
}

function formatSgtDateTime_(ts) {
  var d = ts ? new Date(ts) : new Date();
  var sgt = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  var y = sgt.getUTCFullYear();
  var m = String(sgt.getUTCMonth() + 1);
  if (m.length < 2) m = "0" + m;
  var day = String(sgt.getUTCDate());
  if (day.length < 2) day = "0" + day;
  var h = String(sgt.getUTCHours());
  if (h.length < 2) h = "0" + h;
  var min = String(sgt.getUTCMinutes());
  if (min.length < 2) min = "0" + min;
  return y + "-" + m + "-" + day + " " + h + ":" + min;
}

function formatSgtDateKey_(date) {
  var d = new Date(date.getTime() + (8 * 60 * 60 * 1000));
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1);
  if (m.length < 2) m = "0" + m;
  var day = String(d.getUTCDate());
  if (day.length < 2) day = "0" + day;
  return y + "-" + m + "-" + day;
}

function logEvent_(type, data) {
  try {
    var sheet = getLogsSheet_();
    var ts = new Date().toISOString();
    var chatId = data && data.chat_id != null ? String(data.chat_id) : "";
    var text = data && data.text != null ? String(data.text) : "";
    var json = JSON.stringify(data || {});
    sheet.appendRow([ts, type, chatId, text, json]);
  } catch (e) {
    if (DEBUG) log_("logEventError", String(e));
  }
}

function clearOldLogs_() {
  var sheet = getLogsSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  var cutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  var kept = [data[0]];
  var cleared = 0;
  for (var i = 1; i < data.length; i++) {
    var ts = data[i][0];
    var tsDate = ts ? new Date(ts) : null;
    if (tsDate && isFinite(tsDate.getTime()) && tsDate < cutoff) {
      cleared++;
      continue;
    }
    kept.push(data[i]);
  }
  if (cleared) {
    sheet.clearContents();
    sheet.getRange(1, 1, kept.length, kept[0].length).setValues(kept);
    logEvent_("logs_cleared", { cleared: cleared, remaining: kept.length - 1 });
  }
}

function parseCommand_(text) {
  var clean = normalizeText_(text);
  var parts = clean.split(/\s+/).filter(function (p) { return p; });
  if (!parts.length) return { command: "", args: [] };
  var cmd = parts[0];
  if (cmd.indexOf("@") !== -1) cmd = cmd.split("@")[0];
  return { command: cmd, args: parts.slice(1) };
}

function buildWelcomeMessage_() {
  return [
    "Welcome! This bot links your EVS account to show your meter info, balance, and month-to-date usage.",
    "",
    "<b>Important: This bot is not affiliated with EVS or NUS. There is no expectation of privacy. If you want full data ownership, deploy your own instance from:</b>",
    '<b><a href="https://github.com/lucasisnotcool/evs_bot">GitHub repo</a></b>',
    "",
    "To get started, /login:",
    "<code>/login &lt;username&gt; &lt;password&gt;</code>",
    "",
    "Example:",
    "<code>/login 10001234 0A1234</code>"
  ].join("\n");
}

function buildHelpMessage_() {
  return [
    "Commands:",
    "/login <username> <password> - link your EVS account",
    "/status - meter info + balance + usage",
    "/myinfo - meter details + location",
    "/history [days] - daily usage (default 7)",
    "/leaderboard - usage rank snapshots",
    "/data [days] - view logged balance data (premium)",
    "/upgrade <code> - unlock premium features",
    "/join_waitlist - join premium waitlist",
    "/leave_waitlist - leave premium waitlist",
    "/notify - manage notifications (premium)",
    "/logout - unlink your EVS account",
    "/help - show this help"
  ].join("\n");
}

function buildCapabilitiesMessage_() {
  return [
    "You're logged in. Here’s what I can do:",
    "• /status - meter info + balance + usage",
    "• /myinfo - meter details + location",
    "• /history [days] - daily usage (default 7)",
    "• /leaderboard - usage rank snapshots",
    "• /data [days] - view logged balance data (premium)",
    "• /join_waitlist - join premium waitlist",
    "• /leave_waitlist - leave premium waitlist",
    "• /logout - unlink your EVS account",
    "",
    "Use the buttons below or type a command."
  ].join("\n");
}

function buildMainMenu_() {
  return {
    inline_keyboard: [
      [{ text: "Status", callback_data: "cmd:status" }, { text: "Balance", callback_data: "cmd:balance" }],
      [{ text: "Usage", callback_data: "cmd:usage" }, { text: "Help", callback_data: "cmd:help" }],
      [{ text: "Logout", callback_data: "cmd:logout" }]
    ]
  };
}

function log_(label, obj) {
  if (!DEBUG) return;
  try {
    Logger.log(label + ": " + JSON.stringify(obj));
  } catch (e) {
    Logger.log(label + ": " + String(obj));
  }
}

function handleCallback_(callback) {
  var data = callback.data || "";
  var chatId = callback.message && callback.message.chat ? String(callback.message.chat.id) : "";
  if (!chatId) {
    tgRequest_("answerCallbackQuery", { callback_query_id: callback.id, text: "No chat context." });
    return;
  }
  if (data.indexOf("cmd:") === 0) {
    var cmd = data.slice(4);
    tgRequest_("answerCallbackQuery", { callback_query_id: callback.id });
    dispatchCommand_(chatId, "/" + cmd);
    return;
  }
  tgRequest_("answerCallbackQuery", { callback_query_id: callback.id, text: "Unknown action." });
}

function dispatchCommand_(chatId, commandText) {
  var user = getUser_(chatId);
  var parsed = parseCommand_(commandText);
  if (parsed.command === "/help") {
    sendMessage_(chatId, buildHelpMessage_());
    return;
  }
  if (parsed.command === "/upgrade") {
    handleUpgrade_(chatId, parsed.args);
    return;
  }
  if (parsed.command === "/join_waitlist") {
    handleWaitlistJoin_(chatId);
    return;
  }
  if (parsed.command === "/leave_waitlist") {
    handleWaitlistLeave_(chatId);
    return;
  }
  if (parsed.command === "/logout") {
    setUser_(chatId, { username: "", password: "", state: "", meter_displayname: "", meter_sn: "" });
    setMyCommandsForChat_(chatId, null);
    sendMessage_(chatId, "Logged out. Your EVS account has been unlinked.");
    return;
  }
  if (parsed.command === "/status" || parsed.command === "/balance" || parsed.command === "/usage" || parsed.command === "/myinfo" || parsed.command === "/history" || parsed.command === "/notify" || parsed.command === "/leaderboard" || parsed.command === "/data") {
    if (!user || !user.username || !user.password) {
      setUser_(chatId, { state: "await_username" });
      sendMessage_(chatId, "Please login first. Send /login <username> <password>.");
      return;
    }
    if (parsed.command === "/balance" || parsed.command === "/usage") {
      handleStatus_(chatId, user);
    } else if (parsed.command === "/myinfo") {
      handleMyInfo_(chatId, user);
    } else if (parsed.command === "/history") {
      handleHistory_(chatId, user, parsed.args);
    } else if (parsed.command === "/notify") {
      handleNotify_(chatId, user, parsed.args);
    } else if (parsed.command === "/leaderboard") {
      handleLeaderboard_(chatId, user, parsed.args);
    } else if (parsed.command === "/data") {
      handleData_(chatId, user, parsed.args);
    } else {
      handleStatus_(chatId, user);
    }
  }
}

function setMyCommandsDefault_() {
  var commands = getCommandsLoggedOut_();
  return tgRequest_("setMyCommands", { commands: commands, scope: { type: "all_private_chats" } });
}

function setMyCommandsForChat_(chatId, user) {
  var commands = getCommandsForUser_(user);
  if (!commands || !commands.length) return;
  return tgRequest_("setMyCommands", { commands: commands, scope: { type: "chat", chat_id: chatId } });
}

function getCommandsForUser_(user) {
  if (!user || !user.username || !user.password) return getCommandsLoggedOut_();
  if (isPremiumUser_(user)) return getCommandsLoggedInPremium_();
  return getCommandsLoggedIn_();
}

function getCommandsLoggedOut_() {
  return [
    { command: "start", description: "Welcome + setup instructions" },
    { command: "help", description: "Show help" },
    { command: "login", description: "Link your EVS account" }
  ];
}

function getCommandsLoggedIn_() {
  return [
    { command: "status", description: "Meter info + balance + usage" },
    { command: "myinfo", description: "Meter details + location" },
    { command: "history", description: "Daily usage history" },
    { command: "leaderboard", description: "Usage rank snapshots" },
    { command: "upgrade", description: "Unlock premium features" },
    // { command: "join_waitlist", description: "Join premium waitlist" },
    // { command: "leave_waitlist", description: "Leave premium waitlist" },
    { command: "help", description: "Show help" },
    { command: "logout", description: "Unlink your EVS account" }
  ];
}

function getCommandsLoggedInPremium_() {
  return [
    { command: "status", description: "Meter info + balance + usage" },
    { command: "myinfo", description: "Meter details + location" },
    { command: "history", description: "Daily usage history" },
    { command: "leaderboard", description: "Usage rank snapshots" },
    { command: "data", description: "View logged balance data" },
    { command: "notify", description: "Notifications" },
    { command: "help", description: "Show help" },
    { command: "logout", description: "Unlink your EVS account" }
  ];
}

function getAllowedUpdates_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("TELEGRAM_ALLOWED_UPDATES");
  if (!raw) return ["message", "edited_message", "callback_query"];
  var parsed = safeJsonParse_(raw);
  if (parsed && parsed.length) return parsed;
  return ["message", "edited_message", "callback_query"];
}

function escapeMarkdownV2_(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=\|{}.!])/g, "\\$1");
}

function tgRequest_(method, payload) {
  var token = getBotToken_();
  var url = TELEGRAM.apiBase + token + "/" + method;
  var options = {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(url, options);
  var text = resp.getContentText() || "";
  var data = safeJsonParse_(text) || { ok: false, error_code: resp.getResponseCode(), description: text };
  if (DEBUG) log_("telegramApi", { method: method, code: resp.getResponseCode(), ok: data.ok, description: data.description });
  logEvent_("telegram_api", { method: method, ok: data.ok, error_code: data.error_code, description: data.description });
  return data;
}

function safeJsonParse_(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function normalizeText_(text) {
  return String(text || "")
    .replace(/\u200B/g, "")
    .replace(/\uFEFF/g, "")
    .trim();
}

function normalizeUsername_(username) {
  return String(username == null ? "" : username).trim();
}

function errorToMessage_(err) {
  var msg = String(err || "");
  if (msg.indexOf("Not authorized for this operation") !== -1) {
    return "Access denied by EVS for this account. Please verify your EVS access or contact the administrator.";
  }
  if (msg.indexOf("Login failed") !== -1) {
    return "Login failed. Please check your username/password and try again.";
  }
  return "Error: " + msg;
}

function loginFailureMessage_(err) {
  var msg = String(err || "");
  if (msg.indexOf("Not authorized for this operation") !== -1) {
    return "Logged in, but EVS denied access to meter data for this account. Please verify your EVS access.";
  }
  return "Login failed. Please check your username/password and try again.";
}

function logUpdateSummary_(update) {
  if (!update) {
    logEvent_("update_summary", { ok: false, reason: "empty" });
    return;
  }
  if (update.message) {
    logEvent_("update_summary", {
      type: "message",
      chat_id: update.message.chat ? update.message.chat.id : "",
      message_id: update.message.message_id,
      text: update.message.text || ""
    });
    return;
  }
  if (update.callback_query) {
    logEvent_("update_summary", {
      type: "callback_query",
      chat_id: update.callback_query.message && update.callback_query.message.chat ? update.callback_query.message.chat.id : "",
      data: update.callback_query.data || ""
    });
    return;
  }
  logEvent_("update_summary", { type: "other", keys: Object.keys(update) });
}

function shouldProcessUpdateId_(updateId) {
  if (updateId == null) return true;
  var current = Number(updateId);
  if (!isFinite(current)) return false;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(2000);
    var last = getLastUpdateId_();
    if (last != null && current <= last) {
      logEvent_("update_id_skipped", { update_id: current, last_update_id: last });
      return false;
    }
    return true;
  } catch (e) {
    logEvent_("update_id_lock_error", { update_id: current, error: String(e) });
    return true;
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function markUpdateProcessed_(updateId) {
  if (updateId == null) return;
  var current = Number(updateId);
  if (!isFinite(current)) return;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(2000);
    var last = getLastUpdateId_();
    if (last == null || current > last) {
      setLastUpdateId_(current);
      logEvent_("update_id_marked", { update_id: current, prev: last });
    }
  } catch (e) {
    // best-effort
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function upsertTelegramUser_(chatId, from) {
  if (!from) return;
  setUser_(chatId, {
    tg_username: from.username || "",
    tg_first_name: from.first_name || "",
    tg_last_name: from.last_name || ""
  });
}

function getLastUpdateId_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("TELEGRAM_LAST_UPDATE_ID");
  if (!raw) return null;
  var num = Number(raw);
  return isFinite(num) ? num : null;
}

function setLastUpdateId_(id) {
  PropertiesService.getScriptProperties().setProperty("TELEGRAM_LAST_UPDATE_ID", String(id));
}
