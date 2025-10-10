sub Main()
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

        decodedValue = invalid
        if decodedResult <> invalid then
            if GetInterface(decodedResult, "ifAssociativeArray") <> invalid then
                decodedValue = decodedResult.Lookup(testCase.field)
                else
                    decodedValue = decodedResult[testCase.field]
                end if
            end if

        print "    baseline value:  "; expectedValue
        print "    runtime value:   "; decodedValue

        encodeMatch = actualEncoded = expectedEncoded
        decodeMatch = decodedValue = expectedValue

        if encodeMatch and decodeMatch then
            print "  OK"
            passed = passed + 1
        else
            print "  FAIL"
            print "    expected encode: "; expectedEncoded
            print "    actual encode:   "; actualEncoded
            print "    expected value:  "; expectedValue
            print "    actual value:    "; decodedValue
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
