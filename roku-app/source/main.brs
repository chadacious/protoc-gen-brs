' Library "pkg:/source/generated/runtime.brs"
' Library "pkg:/source/generated/messages/__index.brs"
' Library "pkg:/source/generated/__baselineData.brs"

sub Main()
    Run("pkg:/source/generated/runtime.brs")
    Run("pkg:/source/generated/messages/__index.brs")
    Run("pkg:/source/generated/__baselineData.brs")
    print "protoc-gen-brs test harness starting..."

    handlers = __pb_getMessageHandlers()
    baseline = GetBaselineData()

    if baseline = invalid then
        print "No baseline data found. Generate fixtures first."
        return
    end if

    cases = baseline.cases
    if cases = invalid or cases.Count() = 0 then
        print "No test cases available."
        return
    end if

    total = cases.Count()
    passed = 0
    runTimer = CreateObject("roTimespan")
    runTimer.Mark()

    for each testCase in cases
        typeName = testCase.type
        fieldName = testCase.field
        valueType = testCase.valueType
        if Type(valueType) <> "String" and Type(valueType) <> "roString" then
            valueType = "unknown"
        end if
        displayType = LCase(valueType)
        if Type(fieldName) <> "String" and Type(fieldName) <> "roString" then
            fieldName = fieldName + ""
        end if
        caseTimer = CreateObject("roTimespan")
        caseTimer.Mark()

        sampleLabel = invalid
        if GetInterface(testCase, "ifAssociativeArray") <> invalid then
            sampleLabel = testCase.Lookup("sampleLabel")
        end if
        labelSuffix = ""
        if sampleLabel <> invalid and sampleLabel <> "" then
            labelSuffix = " [" + sampleLabel + "]"
        end if
        print "Verifying "; displayType; " via "; typeName; "."; fieldName; labelSuffix

        typeKey = typeName
        if GetInterface(testCase, "ifAssociativeArray") <> invalid then
            protoType = testCase.Lookup("protoType")
            if protoType <> invalid and protoType <> "" then
                typeKey = protoType
            end if
        end if
        if handlers = invalid or handlers.DoesExist(typeKey) = false then
            if typeKey <> typeName and handlers <> invalid and handlers.DoesExist(typeName) then
                typeKey = typeName
            else
                print "  Missing handler for type."; typeKey
                print "  duration:  "; caseTimer.TotalMilliseconds(); " ms"
                continue for
            end if
        end if

        handler = handlers[typeKey]
        expectedEncoded = testCase.encodedBase64
        expectedValue = testCase.decoded[testCase.field]

        actualEncoded = handler.encode(testCase.decoded)
        decodedResult = handler.decode(expectedEncoded)

        print "    baseline encode: " + expectedEncoded
        print "    runtime encode:  " + actualEncoded

        decodedValue = ExtractFieldValue(decodedResult, testCase.field)

        print "    baseline value:  "; expectedValue
        print "    runtime value:   "; decodedValue

        encodeMatch = actualEncoded = expectedEncoded
        decodeMatch = ValuesMatch(expectedValue, decodedValue)

        altDecodedMatch = true
        altEncodedFailure = invalid
        altEncodings = invalid
        if GetInterface(testCase, "ifAssociativeArray") <> invalid then
            altEncodings = testCase.Lookup("alternateEncodings")
        end if
        if GetInterface(altEncodings, "ifArray") <> invalid then
            for each altEncoded in altEncodings
                altDecodedResult = handler.decode(altEncoded)
                altDecodedValue = ExtractFieldValue(altDecodedResult, testCase.field)
                if not ValuesMatch(expectedValue, altDecodedValue) then
                    altDecodedMatch = false
                    altEncodedFailure = altEncoded
                    exit for
                end if
            end for
        end if

        if encodeMatch and decodeMatch and altDecodedMatch then
            print "  OK"
            passed = passed + 1
        else
            print "  FAIL"
            print "    expected encode: "; expectedEncoded
            print "    actual encode:   "; actualEncoded
            print "    expected value:  "; expectedValue
            print "    actual value:    "; decodedValue
            if not altDecodedMatch then
                print "    alternate decode failed for: "; altEncodedFailure
            end if
            LogMismatchDetails(testCase, expectedEncoded, actualEncoded, testCase.decoded, decodedResult)
        end if

        print "  duration:  "; caseTimer.TotalMilliseconds(); " ms"
    end for

    videoTestPassed = RunVideoPlaybackAbrParityTest(handlers, baseline)
    if videoTestPassed = true then
        passed = passed + 1
    end if
    total = total + 1

    camelVideoTestPassed = RunVideoPlaybackAbrCamelCaseParityTest(handlers, baseline)
    if camelVideoTestPassed = true then
        passed = passed + 1
    end if
    total = total + 1

    liveDecodePassed = RunVideoPlaybackAbrLiveDecodeTest(handlers, baseline)
    if liveDecodePassed = true then
        passed = passed + 1
    end if
    total = total + 1

    print "Summary: "; passed; " of "; total; " cases passed."
    print "Total duration: "; runTimer.TotalMilliseconds(); " ms"
end sub

function RunVideoPlaybackAbrParityTest(handlers as Object, baseline as Object) as Boolean
    sample = CreateVideoPlaybackAbrSample()
    customCase = FindCustomBaselineCase(baseline, "video_streaming.VideoPlaybackAbrRequest", "snake_case parity")
    return RunVideoPlaybackAbrParityTestInternal(handlers, sample, customCase, "snake_case input")
end function

function RunVideoPlaybackAbrCamelCaseParityTest(handlers as Object, baseline as Object) as Boolean
    camelSample = CreateVideoPlaybackAbrSampleCamelCase()
    customCase = FindCustomBaselineCase(baseline, "video_streaming.VideoPlaybackAbrRequest", "snake_case parity")
    return RunVideoPlaybackAbrParityTestInternal(handlers, camelSample, customCase, "camelCase input")
end function

function RunVideoPlaybackAbrLiveDecodeTest(handlers as Object, baseline as Object) as Boolean
    print "Verifying complex message via VideoPlaybackAbrRequest live decode"
    timer = CreateObject("roTimespan")
    timer.Mark()

    handler = invalid
    if handlers <> invalid then
        if handlers.DoesExist("VideoPlaybackAbrRequest") then
            handler = handlers["VideoPlaybackAbrRequest"]
        else if handlers.DoesExist("video_streaming.VideoPlaybackAbrRequest") then
            handler = handlers["video_streaming.VideoPlaybackAbrRequest"]
        end if
    end if

    if handler = invalid then
        print "  FAIL"
        print "    handler for VideoPlaybackAbrRequest not found"
        print "  duration:  "; timer.TotalMilliseconds(); " ms"
        return false
    end if

    baselineCase = FindCustomBaselineCase(baseline, "video_streaming.VideoPlaybackAbrRequest", "snake_case parity")
    if baselineCase = invalid then
        print "  FAIL"
        print "    baseline case not found"
        print "  duration:  "; timer.TotalMilliseconds(); " ms"
        return false
    end if

    expectedDecoded = NormalizeVideoPlaybackAbrDecoded(CloneDecodedMessage(baselineCase.decoded))
    decodedLive = handler.decode(GetVideoPlaybackExpectedLiveBase64())
    prunedLiveEncoded = handler.encode(CloneDecodedMessage(decodedLive))
    decodedResult = NormalizeVideoPlaybackAbrDecoded(CloneDecodedMessage(handler.decode(prunedLiveEncoded)))
    expectedJson = FormatJson(expectedDecoded)
    actualJson = FormatJson(decodedResult)

    if expectedJson = actualJson then
        print "  OK"
        print "    baseline encode: "; baselineCase.encodedBase64
        print "    live payload:    "; GetVideoPlaybackExpectedLiveBase64()
        print "  duration:  "; timer.TotalMilliseconds(); " ms"
        return true
    end if

    print "  FAIL"
    print "    expected json: " + expectedJson
    print "    runtime  json: " + actualJson
    LogMismatchDetails(baselineCase, baselineCase.encodedBase64, GetVideoPlaybackExpectedLiveBase64(), expectedDecoded, decodedResult)
    print "  duration:  "; timer.TotalMilliseconds(); " ms"
    return false
end function

function RunVideoPlaybackAbrParityTestInternal(handlers as Object, encodeSample as Object, baselineCase as Object, label as String) as Boolean
    prefix = "Verifying complex message via VideoPlaybackAbrRequest parity"
    if label <> invalid and label <> "" then
        print prefix; " ["; label; "]"
    else
        print prefix
    end if
    timer = CreateObject("roTimespan")
    timer.Mark()

    handler = invalid
    if handlers <> invalid then
        if handlers.DoesExist("VideoPlaybackAbrRequest") then
            handler = handlers["VideoPlaybackAbrRequest"]
        else if handlers.DoesExist("video_streaming.VideoPlaybackAbrRequest") then
            handler = handlers["video_streaming.VideoPlaybackAbrRequest"]
        end if
    end if

    if handler = invalid then
        print "  FAIL"
        print "    handler for VideoPlaybackAbrRequest not found"
        print "  duration:  "; timer.TotalMilliseconds(); " ms"
        return false
    end if

    if baselineCase = invalid then
        print "  FAIL"
        print "    baseline case not found"
        print "  duration:  "; timer.TotalMilliseconds(); " ms"
        return false
    end if

    expectedEncoded = baselineCase.encodedBase64
    expectedNormalized = NormalizeVideoPlaybackAbrDecoded(CloneDecodedMessage(baselineCase.decoded))

    runtimeEncoded = handler.encode(encodeSample)
    decodedResult = handler.decode(expectedEncoded)
    prunedEncoded = handler.encode(CloneDecodedMessage(decodedResult))
    decodedResult = handler.decode(prunedEncoded)
    decodedNormalized = NormalizeVideoPlaybackAbrDecoded(CloneDecodedMessage(decodedResult))

    encodeMatch = runtimeEncoded = expectedEncoded
    expectedJson = FormatJson(expectedNormalized)
    actualJson = FormatJson(decodedNormalized)
    decodeMatch = (expectedJson = actualJson)

    if encodeMatch and decodeMatch then
        print "  OK"
        print "    expected encode: "; expectedEncoded
        print "    runtime encode:  "; runtimeEncoded
        print "  duration:  "; timer.TotalMilliseconds(); " ms"
        return true
    end if

    print "  FAIL"
    print "    expected encode: "; expectedEncoded
    print "    runtime encode:  "; runtimeEncoded
    if not decodeMatch then
        print "    decoded value mismatch"
        print "    expected json: " + expectedJson
        print "    runtime  json: " + actualJson
        diag = { type: baselineCase.protoType, field: "(full message)", fieldId: -1, sampleLabel: label }
        LogMismatchDetails(diag, expectedEncoded, runtimeEncoded, expectedNormalized, decodedNormalized)
    end if
    print "  duration:  "; timer.TotalMilliseconds(); " ms"
    return false
end function

function FindCustomBaselineCase(baseline as Object, protoType as String, sampleLabel as String) as Object
    if baseline = invalid then return invalid
    if GetInterface(baseline, "ifAssociativeArray") = invalid then return invalid
    cases = baseline.Lookup("customCases")
    if GetInterface(cases, "ifArray") = invalid then return invalid
    targetProto = protoType
    targetLabel = sampleLabel
    for each entry in cases
        if entry <> invalid then
            entryProto = "" + entry.protoType
            entryLabel = "" + entry.sampleLabel
            if entryProto = targetProto then
                if targetLabel = "" or entryLabel = targetLabel then
                    return entry
                end if
            end if
        end if
    end for
    return invalid
end function

function CreateVideoPlaybackAbrSample() as Object
    sample = {}

    abrState = {}
    abrState.playback_rate = 1
    abrState.player_time_ms = "0"
    abrState.client_viewport_is_flexible = false
    abrState.bandwidth_estimate = "9050000"
    abrState.drc_enabled = false
    abrState.enabled_track_types_bitfield = 2
    abrState.sticky_resolution = 1080
    abrState.last_manual_selected_resolution = 1080
    sample.client_abr_state = abrState

    bufferedRanges = CreateObject("roArray", 0, true)
    range = {}
    range.format_id = CreateAudioFormatSnake()
    range.start_time_ms = "0"
    range.duration_ms = "2147483647"
    range.start_segment_index = 2147483647
    range.end_segment_index = 2147483647
    timeRange = {}
    timeRange.duration_ticks = "2147483647"
    timeRange.start_ticks = "0"
    timeRange.timescale = 1000
    range.time_range = timeRange
    bufferedRanges.Push(range)
    sample.buffered_ranges = bufferedRanges

    selectedFormatIds = CreateObject("roArray", 0, true)
    selectedFormatIds.Push(CreateAudioFormatSnake())
    sample.selected_format_ids = selectedFormatIds

    preferredAudio = CreateObject("roArray", 0, true)
    preferredAudio.Push(CreateAudioFormatSnake())
    sample.preferred_audio_format_ids = preferredAudio

    preferredVideo = CreateObject("roArray", 0, true)
    preferredVideo.Push(CreateVideoFormatSnake())
    sample.preferred_video_format_ids = preferredVideo

    sample.preferred_subtitle_format_ids = CreateObject("roArray", 0, true)

    streamerContext = {}
    clientInfo = {}
    clientInfo.os_name = "Windows"
    clientInfo.os_version = "10.0"
    clientInfo.client_name = 1
    clientInfo.client_version = "2.20250222.10.00"
    streamerContext.client_info = clientInfo
    streamerContext.sabr_contexts = CreateObject("roArray", 0, true)
    streamerContext.unsent_sabr_contexts = CreateObject("roArray", 0, true)
    streamerContext.po_token = GetStreamerContextPoTokenBase64()
    sample.streamer_context = streamerContext

    sample.field1000 = CreateObject("roArray", 0, true)
    sample.video_playback_ustreamer_config = GetVideoPlaybackUstreamerConfigBase64()

    return sample
end function

function CreateVideoPlaybackAbrSampleCamelCase() as Object
    sample = {}

    abrState = {}
    abrState.playbackRate = 1
    abrState.playerTimeMs = "0"
    abrState.clientViewportIsFlexible = false
    abrState.bandwidthEstimate = "9050000"
    abrState.drcEnabled = false
    abrState.enabledTrackTypesBitfield = 2
    abrState.stickyResolution = 1080
    abrState.lastManualSelectedResolution = 1080
    sample.clientAbrState = abrState

    bufferedRanges = CreateObject("roArray", 0, true)
    range = {}
    range.formatId = CreateAudioFormatCamel()
    range.startTimeMs = "0"
    range.durationMs = "2147483647"
    range.startSegmentIndex = 2147483647
    range.endSegmentIndex = 2147483647
    timeRange = {}
    timeRange.durationTicks = "2147483647"
    timeRange.startTicks = "0"
    timeRange.timescale = 1000
    range.timeRange = timeRange
    bufferedRanges.Push(range)
    sample.bufferedRanges = bufferedRanges

    selectedFormatIds = CreateObject("roArray", 0, true)
    selectedFormatIds.Push(CreateAudioFormatCamel())
    sample.selectedFormatIds = selectedFormatIds

    preferredAudio = CreateObject("roArray", 0, true)
    preferredAudio.Push(CreateAudioFormatCamel())
    sample.preferredAudioFormatIds = preferredAudio

    preferredVideo = CreateObject("roArray", 0, true)
    preferredVideo.Push(CreateVideoFormatCamel())
    sample.preferredVideoFormatIds = preferredVideo

    sample.preferredSubtitleFormatIds = CreateObject("roArray", 0, true)

    streamerContext = {}
    clientInfo = {}
    clientInfo.osName = "Windows"
    clientInfo.osVersion = "10.0"
    clientInfo.clientName = 1
    clientInfo.clientVersion = "2.20250222.10.00"
    streamerContext.clientInfo = clientInfo
    streamerContext.sabrContexts = CreateObject("roArray", 0, true)
    streamerContext.unsentSabrContexts = CreateObject("roArray", 0, true)
    streamerContext.poToken = CreateByteArrayFromBase64(GetStreamerContextPoTokenBase64())
    sample.streamerContext = streamerContext

    sample.field1000 = CreateObject("roArray", 0, true)
    sample.videoPlaybackUstreamerConfig = CreateByteArrayFromBase64(GetVideoPlaybackUstreamerConfigBase64())

    return sample
end function

function CreateAudioFormatSnake() as Object
    format = {}
    format.itag = 140
    format.last_modified = "1759475037898391"
    format.mime_type = "audio/mp4; codecs=""mp4a.40.2"""
    format.audio_quality = "AUDIO_QUALITY_MEDIUM"
    format.bitrate = 131174
    format.average_bitrate = 129531
    format.quality = "tiny"
    format.approx_duration_ms = 282846
    format.content_length = 4579674
    format.is_drc = false
    format.is_auto_dubbed = false
    format.is_descriptive = false
    format.is_dubbed = false
    format.language = invalid
    format.is_original = true
    format.is_secondary = false
    return format
end function

function CreateAudioFormatCamel() as Object
    format = {}
    format.itag = 140
    format.lastModified = "1759475037898391"
    format.mimeType = "audio/mp4; codecs=""mp4a.40.2"""
    format.audioQuality = "AUDIO_QUALITY_MEDIUM"
    format.bitrate = 131174
    format.averageBitrate = 129531
    format.quality = "tiny"
    format.approxDurationMs = 282846
    format.contentLength = 4579674
    format.isDrc = false
    format.isAutoDubbed = false
    format.isDescriptive = false
    format.isDubbed = false
    format.language = invalid
    format.isOriginal = true
    format.isSecondary = false
    return format
end function

function CreateVideoFormatSnake() as Object
    format = {}
    format.itag = 399
    format.last_modified = "1759475866788004"
    format.width = 1080
    format.height = 1080
    format.mime_type = "video/mp4; codecs=""av01.0.08M.08"""
    format.bitrate = 63000
    format.average_bitrate = 30563
    format.quality = "hd1080"
    format.quality_label = "1080p"
    format.approx_duration_ms = 282840
    format.content_length = 1080576
    return format
end function

function CreateVideoFormatCamel() as Object
    format = {}
    format.itag = 399
    format.lastModified = "1759475866788004"
    format.width = 1080
    format.height = 1080
    format.mimeType = "video/mp4; codecs=""av01.0.08M.08"""
    format.bitrate = 63000
    format.averageBitrate = 30563
    format.quality = "hd1080"
    format.qualityLabel = "1080p"
    format.approxDurationMs = 282840
    format.contentLength = 1080576
    return format
end function

function CreateByteArrayFromBase64(base64String as String) as Object
    bytes = CreateObject("roByteArray")
    bytes.FromBase64String(base64String)
    return bytes
end function

function GetVideoPlaybackUstreamerConfigBase64() as String
    return "CuoICucFCAAlAACAPy0zM3M/NT0Klz9YAWgBchoKFm1mczJfY21mc193ZWJfdjNfMl8wMDMYAHiPTqABAagBALgCANoCmwEQsOoBGIDd2wEgoJwBKKCcATCYdXCIJ4AB9AO4AQHgAQOYAgzAAgHQAgLoAgSAAwKIA4gnqAMDwAMByAMBgAQB0AQB2AQB4AQA+AQHgAV9wAUByAUB4AXQD+gFAfgF0A+ABgGQBgG4BgHQBgHwBgH4BgGAB9APwAcB0AcBgAgBiAgBnQjNzEw+oAjoB+AIAegI////////////AfoCtQEtAACgQjUAAKpCZQAAgEBowHCoAdCGA/0BAACAP4UCmpkZP40CAACAP5UC+u1rO7UCAACAP8AC3wPSAhGw//////////8BHjxGWlxdXugC6AL9As3MzD2QAwGdAwrXIz2gAwHVAwAAekSYBAHVBAAAIEHoBPAQoAYBtQa9N4Y1vQYzM4NAwAcByAcB5QcAgAlE8AcBgAgBoQgAAAAAAADwv6kIAAAAAAAA8L+wCN8DuAoB+BABggMAkAMBqAMBsAMD0AMB2AMBygQcChMIwKkHEJh1GOgHJQAAAAAoADAAEODUAxjQD9IEDwoICLAJELAJIAEgiCcoAdoEDQoGCPAuEPAuIPAuKAHwBQGYBgGoBoCAAtIGFAjoBxBkGg0IiCcVAAAAPx3NzEw/2AYBiAcBuAcBoAgB0ggGCAEQARgBqQkAAAAAAADwv7EJAAAAAAAA8L/QCQHaCSRFN2t1UnNsQUU0KzVkS3c3UVh3MFNJMXl1UnhxbUd5SmxJRTjqCwSLBowGgAwBqAyQAcAMAcgMAdAMAYANAYgNAdgNAeANAYAOAYgOAZgOAYgPAcgPAdAPAegQAYARAZARAbIRFENBTVNDaFVQdWJiSkRQd0VzUVk96BEB4BIB8BIB+BIBuBMBwBMB8BMBkRQAAAAAAADwv5kUAAAAAAAA8L+wFAHKFACIp6HKCwEYATIMCIkBELjYiP6+h5ADMgwI+AEQ+aP4icGHkAMyDAiPAxCkwZ+wvoeQAzIMCIgBEKvBubm+h5ADMgwI9wEQsZf2rMKHkAMyDAiOAxDDvtG0voeQAzIMCIcBEPu4o7m+h5ADMgwI9AEQycf/q8KHkAMyDAiNAxCZnIqwvoeQAzIMCIYBEImKkfe+h5ADMgwI8wEQraSDrMKHkAMyDAiMAxD5wduyvoeQAzIMCIUBEMrfrra+h5ADMgwI8gEQlsK9rMKHkAMyDAiLAxD72bK0voeQAzIMCKABELmgkLi+h5ADMgwIlgIQoNjprMKHkAMyDAiKAxCj1OCyvoeQAzIMCIwBEJeNgKW7h5ADMgwI+QEQwIix/LuHkAMyDAj6ARCTzav8u4eQAzIMCPsBENTJrPy7h5ADOgBIAFIqGgJlbigBMhhVQ3Q4VXRXakpBa1VUdmZOdDRhdWZrYmc4AEAAWABgAHgAoAEBsAEFugEDBAUxwgEIAQIDBAUIMF7QAQASTQA/FfG3MEYCIQD7A417/f3b1SiwINyvpwKCIGCfP67AX4uBNq2EyH7UeAIhAOC71fOkiaXyEWZoUox4SAIARbH1vpu8rGmvyZrwLmgNGgJlaQ=="
end function

function GetStreamerContextPoTokenBase64() as String
    return "IjiH/4f+7xlo88SY86zVqvOP0czjh9KV44vKvO2wvsrTt8WVzrTEmM2p0ofOusCYxpjOrqLMw9q0uw=="
end function

function GetVideoPlaybackExpectedLiveBase64() as String
    return "CheAAbgIqAG4CLgBkK+oBJ0CAACAP8ACAhIMCIwBEJeNgKW7h5ADGisKDAiMARCXjYClu4eQAxj/////ByD/////Byj/////BzIJEP////8HGOgHKsAJCuoICucFCAAlAACAPy0zM3M/NT0Klz9YAWgBchoKFm1mczJfY21mc193ZWJfdjNfMl8wMDMYAHiPTqABAagBALgCANoCmwEQsOoBGIDd2wEgoJwBKKCcATCYdXCIJ4AB9AO4AQHgAQOYAgzAAgHQAgLoAgSAAwKIA4gnqAMDwAMByAMBgAQB0AQB2AQB4AQA+AQHgAV9wAUByAUB4AXQD+gFAfgF0A+ABgGQBgG4BgHQBgHwBgH4BgGAB9APwAcB0AcBgAgBiAgBnQjNzEw+oAjoB+AIAegI////////////AfoCtQEtAACgQjUAAKpCZQAAgEBowHCoAdCGA/0BAACAP4UCmpkZP40CAACAP5UC+u1rO7UCAACAP8AC3wPSAhGw//////////8BHjxGWlxdXugC6AL9As3MzD2QAwGdAwrXIz2gAwHVAwAAekSYBAHVBAAAIEHoBPAQoAYBtQa9N4Y1vQYzM4NAwAcByAcB5QcAgAlE8AcBgAgBoQgAAAAAAADwv6kIAAAAAAAA8L+wCN8DuAoB+BABggMAkAMBqAMBsAMD0AMB2AMBygQcChMIwKkHEJh1GOgHJQAAAAAoADAAEODUAxjQD9IEDwoICLAJELAJIAEgiCcoAdoEDQoGCPAuEPAuIPAuKAHwBQGYBgGoBoCAAtIGFAjoBxBkGg0IiCcVAAAAPx3NzEw/2AYBiAcBuAcBoAgB0ggGCAEQARgBqQkAAAAAAADwv7EJAAAAAAAA8L/QCQHaCSRFN2t1UnNsQUU0KzVkS3c3UVh3MFNJMXl1UnhxbUd5SmxJRTjqCwSLBowGgAwBqAyQAcAMAcgMAdAMAYANAYgNAdgNAeANAYAOAYgOAZgOAYgPAcgPAdAPAegQAYARAZARAbIRFENBTVNDaFVQdWJiSkRQd0VzUVk96BEB4BIB8BIB+BIBuBMBwBMB8BMBkRQAAAAAAADwv5kUAAAAAAAA8L+wFAHKFACIp6HKCwEYATIMCIkBELjYiP6+h5ADMgwI+AEQ+aP4icGHkAMyDAiPAxCkwZ+wvoeQAzIMCIgBEKvBubm+h5ADMgwI9wEQsZf2rMKHkAMyDAiOAxDDvtG0voeQAzIMCIcBEPu4o7m+h5ADMgwI9AEQycf/q8KHkAMyDAiNAxCZnIqwvoeQAzIMCIYBEImKkfe+h5ADMgwI8wEQraSDrMKHkAMyDAiMAxD5wduyvoeQAzIMCIUBEMrfrra+h5ADMgwI8gEQlsK9rMKHkAMyDAiLAxD72bK0voeQAzIMCKABELmgkLi+h5ADMgwIlgIQoNjprMKHkAMyDAiKAxCj1OCyvoeQAzIMCIwBEJeNgKW7h5ADMgwI+QEQwIix/LuHkAMyDAj6ARCTzav8u4eQAzIMCPsBENTJrPy7h5ADOgBIAFIqGgJlbigBMhhVQ3Q4VXRXakpBa1VUdmZOdDRhdWZrYmc4AEAAWABgAHgAoAEBsAEFugEDBAUxwgEIAQIDBAUIMF7QAQASTQA/FfG3MEYCIQD7A417/f3b1SiwINyvpwKCIGCfP67AX4uBNq2EyH7UeAIhAOC71fOkiaXyEWZoUox4SAIARbH1vpu8rGmvyZrwLmgNGgJlaYIBDAiMARCXjYClu4eQA4oBDAiPAxCkwZ+wvoeQA5oBZwongAEBigEQMi4yMDI1MDIyMi4xMC4wMJIBB1dpbmRvd3OaAQQxMC4wEjoiOIf/h/7vGWjzxJjzrNWq84/RzOOH0pXji8q87bC+ytO3xZXOtMSYzanSh866wJjGmM6uoszD2rS7MgA="
end function

function CloneDecodedMessage(value as Dynamic) as Dynamic
    if value = invalid then return invalid
    if GetInterface(value, "ifAssociativeArray") <> invalid or GetInterface(value, "ifArray") <> invalid then
        return ParseJson(FormatJson(value))
    end if
    return value
end function

function NormalizeComparisonValue(value as Dynamic) as String
    if value = invalid then return "invalid"
    typeName = Type(value)
    if typeName = "String" or typeName = "roString" then
        return value
    else if typeName = "Boolean" or typeName = "roBoolean" then
        if value = true then
            return "true"
        else
            return "false"
        end if
    end if
    return FormatJson(value)
end function

sub RemoveDefaultField(container as Object, fieldName as String, defaultValue as Dynamic)
    if container = invalid then return
    if GetInterface(container, "ifAssociativeArray") = invalid then return
    if container.DoesExist(fieldName) then
        current = container.Lookup(fieldName)
        currentKey = NormalizeComparisonValue(current)
        defaultKey = NormalizeComparisonValue(defaultValue)
        if currentKey = defaultKey then
            container.Delete(fieldName)
        end if
    end if
end sub

function NormalizeVideoPlaybackAbrDecoded(message as Dynamic) as Dynamic
    if message = invalid then return message
    if GetInterface(message, "ifAssociativeArray") = invalid then return message

    if message.DoesExist("client_abr_state") then
        state = message.client_abr_state
        if GetInterface(state, "ifAssociativeArray") <> invalid then
            RemoveDefaultField(state, "client_viewport_is_flexible", false)
            RemoveDefaultField(state, "player_time_ms", "0")
            RemoveDefaultField(state, "drc_enabled", false)
            keepState = CreateKeySet(["playback_rate", "bandwidth_estimate", "enabled_track_types_bitfield", "sticky_resolution", "last_manual_selected_resolution"])
            KeepOnlyKeys(state, keepState)
        end if
    end if

    RemoveDefaultField(message, "player_time_ms", "0")

    if message.DoesExist("buffered_ranges") then
        ranges = message.buffered_ranges
        if GetInterface(ranges, "ifArray") <> invalid then
            for each range in ranges
                if GetInterface(range, "ifAssociativeArray") <> invalid then
                    RemoveDefaultField(range, "start_time_ms", "0")
                    if range.DoesExist("time_range") then
                        timeRange = range.time_range
                        if GetInterface(timeRange, "ifAssociativeArray") <> invalid then
                            RemoveDefaultField(timeRange, "start_ticks", "0")
                        end if
                    end if
                    if range.DoesExist("format_id") then
                        formatId = range.format_id
                        KeepOnlyKeys(formatId, CreateKeySet(["itag", "last_modified"]))
                    end if
                end if
            end for
        end if
    end if

    if message.DoesExist("selected_format_ids") then
        NormalizeFormatIdArray(message.selected_format_ids)
    end if

    if message.DoesExist("preferred_audio_format_ids") then
        NormalizeFormatIdArray(message.preferred_audio_format_ids)
    end if

    if message.DoesExist("preferred_video_format_ids") then
        NormalizeFormatIdArray(message.preferred_video_format_ids)
    end if

    RemoveEmptyArrayField(message, "preferred_subtitle_format_ids")
    RemoveEmptyArrayField(message, "field1000")
    RemoveDefaultField(message, "field22", 0)
    RemoveDefaultField(message, "field23", 0)

    if message.DoesExist("streamer_context") then
        ctx = message.streamer_context
        if GetInterface(ctx, "ifAssociativeArray") <> invalid then
            if ctx.DoesExist("unsent_sabr_contexts") then
                sabr = ctx.unsent_sabr_contexts
                if GetInterface(sabr, "ifArray") <> invalid and sabr.Count() = 0 then
                    ctx.Delete("unsent_sabr_contexts")
                end if
            end if
            KeepOnlyKeys(ctx, CreateKeySet(["client_info", "po_token"]))
            if ctx.DoesExist("client_info") then
                clientInfo = ctx.client_info
                KeepOnlyKeys(clientInfo, CreateKeySet(["os_name", "os_version", "client_name", "client_version"]))
            end if
        end if
    end if

    return message
end function

sub NormalizeFormatIdArray(formats as Dynamic)
    if formats = invalid then return
    if GetInterface(formats, "ifArray") = invalid then return
    for each format in formats
        if GetInterface(format, "ifAssociativeArray") <> invalid then
            KeepOnlyKeys(format, CreateKeySet(["itag", "last_modified"]))
        end if
    end for
end sub

sub RemoveEmptyArrayField(message as Dynamic, fieldName as String)
    if message = invalid then return
    if GetInterface(message, "ifAssociativeArray") = invalid then return
    if message.DoesExist(fieldName) then
        arr = message[fieldName]
        if GetInterface(arr, "ifArray") <> invalid and arr.Count() = 0 then
            message.Delete(fieldName)
        end if
    end if
end sub

function CreateKeySet(keys as Object) as Object
    set = {}
    if GetInterface(keys, "ifArray") = invalid then return set
    for each key in keys
        set[key] = true
    end for
    return set
end function

sub KeepOnlyKeys(map as Dynamic, allowed as Dynamic)
    if map = invalid or allowed = invalid then return
    if GetInterface(map, "ifAssociativeArray") = invalid then return
    keys = map.Keys()
    for each key in keys
        if allowed.DoesExist(key) = false then
            map.Delete(key)
        end if
    end for
end sub

sub LogMismatchDetails(testCase as Object, baselineEncoded as String, runtimeEncoded as String, baselineDecoded as Object, runtimeDecoded as Object)
    print "    -- mismatch diagnostics --"
    baselineBytes = __pb_fromBase64(baselineEncoded)
    runtimeBytes = __pb_fromBase64(runtimeEncoded)
    print "    baseline bytes ("; safeCount(baselineBytes); "): "; ByteArrayToHex(baselineBytes)
    print "    runtime  bytes ("; safeCount(runtimeBytes); "): "; ByteArrayToHex(runtimeBytes)
    printDecodedAssociative("    baseline decoded", baselineDecoded)
    printDecodedAssociative("    runtime  decoded", runtimeDecoded)
    sampleLabel = invalid
    if GetInterface(testCase, "ifAssociativeArray") <> invalid then
        sampleLabel = testCase.Lookup("sampleLabel")
    end if
    if sampleLabel <> invalid and sampleLabel <> "" then
        print "    sample label: "; sampleLabel
    end if
    print "    case meta: type="; testCase.type; " field="; testCase.field; " fieldId="; testCase.fieldId
    print "    ---------------------------"
end sub

function ExtractFieldValue(container as Dynamic, fieldName as String) as Dynamic
    if container = invalid then return invalid
    if GetInterface(container, "ifAssociativeArray") <> invalid then
        if container.DoesExist(fieldName) then
            return container[fieldName]
        end if
        return container.Lookup(fieldName)
    end if
    return container[fieldName]
end function

function ValuesMatch(expected as Dynamic, actual as Dynamic) as Boolean
    if expected = invalid and actual = invalid then return true
    if expected = invalid or actual = invalid then return false

    if IsArrayValue(expected) and IsArrayValue(actual) then
        if expected.Count() <> actual.Count() then return false
        for i = 0 to expected.Count() - 1
            if not ValuesMatch(expected[i], actual[i]) then return false
        end for
        return true
    end if

    if IsAssociativeValue(expected) and IsAssociativeValue(actual) then
        keys = expected.Keys()
        otherKeys = actual.Keys()
        if otherKeys.Count() <> keys.Count() then return false
        for each key in keys
            if actual.DoesExist(key) = false then return false
            if not ValuesMatch(expected[key], actual[key]) then return false
        end for
        return true
    end if

    return expected = actual
end function

function IsArrayValue(value as Dynamic) as Boolean
    return value <> invalid and GetInterface(value, "ifArray") <> invalid
end function

function IsAssociativeValue(value as Dynamic) as Boolean
    return value <> invalid and GetInterface(value, "ifAssociativeArray") <> invalid
end function

function ByteArrayToHex(bytes as Object) as String
    if bytes = invalid then return "<invalid>"
    hex = ""
    for i = 0 to bytes.Count() - 1
        value = bytes[i]
        hexByte = UCase(StrI(value, 16))
        if Len(hexByte) < 2 then
            hexByte = Right("0" + hexByte, 2)
        end if
        hex = hex + hexByte
        if i < bytes.Count() - 1 then
            hex = hex + " "
        end if
    end for
    return hex
end function

sub printDecodedAssociative(prefix as String, data as Object)
    if data = invalid then
        print prefix; ": <invalid>"
        return
    end if
    if GetInterface(data, "ifAssociativeArray") = invalid then
        print prefix; ": "; data
        return
    end if
    print prefix; ":"
    keys = data.Keys()
    for each key in keys
        print "        "; key; " => "; data[key]
    end for
end sub

function safeCount(bytes as Object) as Integer
    if bytes = invalid then return 0
    return bytes.Count()
end function
