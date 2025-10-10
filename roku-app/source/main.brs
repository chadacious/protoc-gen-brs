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

        if handlers = invalid or handlers.DoesExist(typeName) = false then
            print "  Missing handler for type."; typeName
        else
            handler = handlers[typeName]
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
        end if

        print "  duration:  "; caseTimer.TotalMilliseconds(); " ms"
    end for

    print "Summary: "; passed; " of "; total; " cases passed."
    print "Total duration: "; runTimer.TotalMilliseconds(); " ms"
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
